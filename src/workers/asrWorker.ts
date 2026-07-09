// ASR Worker - 浏览器端 ASR 处理（Whisper / Moonshine via Transformers.js）
// 生成句子级别时间戳，适合字幕编辑

import { env, pipeline } from '@huggingface/transformers';
import type { ASRProgress, SubtitleTranscript } from '../types/subtitle';
import { isValidLanguageCode } from '../constants/languages';
import type { TransformersASREngineConfig } from '../services/asrEngines/TransformersASREngine';
import { logAsrModelOutput } from '../utils/asrOutputLog';

// 本 worker 通过 `?worker&inline` 内联为 blob URL 运行。
// onnxruntime-web 的 WebGPU 后端会用相对路径动态 import 胶水模块
// (`ort-wasm-simd-threaded.jsep.mjs`) 并 fetch 对应 .wasm，而 blob URL
// 无法解析相对路径，导致 "Importing a module script failed" →
// "no available backend found"。这里把 wasmPaths 指向绝对 CDN 地址，
// 让 ort 用完整 URL 加载，从而在内联 worker 中恢复 WebGPU 支持。
// 注意：版本需与 package.json 中 @huggingface/transformers 保持一致。
env.backends.onnx.wasm!.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/';

// transformers.js 不支持直接将 HTTP URL 作为模型 ID
// 我们需要拦截文件加载请求，将 Hugging Face Hub 的 URL 重定向到 OSS
// 方法：重写全局 fetch 函数来拦截模型文件请求

// 保存原始的 fetch 函数
const originalFetch = globalThis.fetch;

let activeConfig: TransformersASREngineConfig | null = null;

type HubProgressInfo = {
  status?: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

const filesLoading: Record<string, { loaded: number; total: number }> = {};

function resetFilesLoading() {
  for (const key of Object.keys(filesLoading)) {
    delete filesLoading[key];
  }
}

function formatFileLabel(file?: string) {
  if (!file) return '模型文件';
  const parts = file.split('/');
  return parts[parts.length - 1] || file;
}

/** 将 transformers.js hub 进度事件规范为 ASRProgress，并汇总多文件总进度 */
function normalizeHubProgress(raw: HubProgressInfo): ASRProgress | null {
  const status = raw.status;
  const file = raw.file;
  const fileLabel = formatFileLabel(file);

  if (status === 'ready') {
    return {
      status: 'loading',
      data: '正在初始化模型...',
      file,
      progress: 99,
    };
  }

  if (status === 'initiate' || status === 'download') {
    return {
      status: 'loading',
      data: status === 'initiate' ? `准备下载 ${fileLabel}` : `正在下载 ${fileLabel}`,
      file,
    };
  }

  if (status === 'progress') {
    if (file) {
      filesLoading[file] = {
        loaded: raw.loaded ?? 0,
        total: raw.total ?? 0,
      };
    }

    const aggregate = Object.values(filesLoading).reduce(
      (acc, entry) => ({
        loaded: acc.loaded + entry.loaded,
        total: acc.total + entry.total,
      }),
      { loaded: 0, total: 0 },
    );

    const progress = aggregate.total > 0
      ? Math.min(100, Math.round((aggregate.loaded / aggregate.total) * 100))
      : Math.round(raw.progress ?? 0);

    return {
      status: 'progress',
      data: `正在下载 ${fileLabel}`,
      file,
      progress,
      total: aggregate.total > 0 ? aggregate.total : raw.total,
    };
  }

  // 单文件完成事件不单独上报，避免进度条闪烁回 0
  if (status === 'done') {
    return null;
  }

  return null;
}

function resolveModelFileUrl(url: string): string | null {
  if (!activeConfig?.modelBaseUrl) return null;
  if (!url.includes('huggingface.co') || !url.includes(activeConfig.modelId)) return null;

  const escapedModelId = activeConfig.modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = url.match(new RegExp(`${escapedModelId}/(?:resolve|raw)/[^/]+/(.+)$`));
  const filePath = match?.[1] || url.match(new RegExp(`${escapedModelId}/(.+)$`))?.[1]?.replace(/^(resolve|raw)\/[^/]+\//, '');

  return filePath ? `${activeConfig.modelBaseUrl}/${filePath}` : null;
}

// 重写 fetch 函数以从 OSS 加载文件
globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  const modelFileUrl = url ? resolveModelFileUrl(url) : null;
  if (modelFileUrl) {
    console.log(`🔄 重定向模型文件: ${url} -> ${modelFileUrl}`);
    return originalFetch(modelFileUrl, init);
  }

  // 其他请求使用原始 fetch
  return originalFetch(input, init);
};

// 按 family 构造 transformers.js 的 pipeline 选项
// Whisper 系列包含 encoder_model + decoder_model_merged，可分别指定 dtype；
// Moonshine 包含 preprocessor/encoder/uncached_decoder/cached_decoder，
// 默认权重本身就是 int8 量化版本，直接用 'q8' 在 WASM 下最稳，
// WebGPU 暂时不显式指定 dtype，由 transformers.js 自行决策。
function buildPipelineOptions(config: TransformersASREngineConfig, progress_callback?: (progress: unknown) => void) {
  const base: Record<string, unknown> = { progress_callback };

  if (config.family === 'moonshine') {
    if (config.device === 'wasm') {
      base.dtype = 'q8';
    }
    // webgpu：不指定 dtype，交给 transformers.js 默认处理
    base.device = config.device;
    return base;
  }

  // 默认 whisper
  if (config.device === 'webgpu') {
    base.dtype = {
      encoder_model: 'fp32',
      decoder_model_merged: 'q4',
    };
  } else {
    base.dtype = 'q8';
  }
  base.device = config.device;
  return base;
}

/**
 * ASR 管道单例模式 - 句子级别时间戳版本
 */
class PipelineSingleton {
  static instance: Awaited<ReturnType<typeof pipeline>> | null = null;
  static cacheKey = '';

  static async getInstance(config: TransformersASREngineConfig, progress_callback?: (progress: unknown) => void) {
    const cacheKey = JSON.stringify({
      modelId: config.modelId,
      modelBaseUrl: config.modelBaseUrl,
      family: config.family,
      device: config.device,
    });

    if (this.cacheKey !== cacheKey) {
      this.instance = null;
      this.cacheKey = cacheKey;
    }

    if (!this.instance) {
      activeConfig = config;
      console.log('ASR创建新的管道实例:', { family: config.family, device: config.device, modelId: config.modelId, modelBaseUrl: config.modelBaseUrl });

      const options = buildPipelineOptions(config, progress_callback);
      this.instance = pipeline('automatic-speech-recognition', config.modelId, options);
    }
    return this.instance;
  }
}

/**
 * 仅下载模型文件到浏览器缓存（不预热、不标记为可识别）
 */
async function downloadModelOnly({ config }: { config: TransformersASREngineConfig }) {
  activeConfig = config;
  resetFilesLoading();
  console.log('ASR Worker开始下载模型:', config);

  self.postMessage({
    status: 'loading',
    data: `正在下载模型 (${config.family})...`,
    progress: 0,
  } satisfies ASRProgress);

  try {
    await PipelineSingleton.getInstance(config, (progress) => {
      const normalized = normalizeHubProgress(progress as HubProgressInfo);
      if (normalized) {
        self.postMessage(normalized);
      }
    });

    console.log('ASR模型下载完成');
    self.postMessage({
      status: 'downloaded',
      data: '模型下载完成',
      progress: 100,
    } satisfies ASRProgress);
  } catch (error) {
    console.error('ASR模型下载失败:', error);
    self.postMessage({
      status: 'error',
      error: error instanceof Error ? error.message : '模型下载失败',
    } satisfies ASRProgress);
  }
}

/**
 * 加载 ASR 模型（识别前调用，含 WebGPU 预热）
 */
async function load({ config }: { config: TransformersASREngineConfig }) {
  activeConfig = config;
  resetFilesLoading();
  console.log('ASR Worker开始加载模型:', config);
  
  self.postMessage({
    status: 'loading',
    data: `正在加载模型 (${config.family} / ${config.device})...`,
    progress: 0,
  } satisfies ASRProgress);

  try {
    // 加载管道并保存以供将来使用
    const transcriber = await PipelineSingleton.getInstance(config, (progress) => {
      const normalized = normalizeHubProgress(progress as HubProgressInfo);
      console.log('ASR模型加载进度:', progress, normalized);
      if (normalized) {
        self.postMessage(normalized);
      }
    });

    // WebGPU 需要预热（仅 whisper 系列传入 language 选项）
    if (config.device === 'webgpu') {
      self.postMessage({
        status: 'loading',
        data: '正在编译着色器并预热模型...',
      } satisfies ASRProgress);

      const warmupOpts: Record<string, unknown> = {};
      if (config.family === 'whisper') {
        warmupOpts.language = config.language;
      }
      await transcriber(new Float32Array(16_000), warmupOpts);
    }

    console.log('ASR模型加载完成');
    self.postMessage({ status: 'loaded' } satisfies ASRProgress);
    
  } catch (error) {
    console.error('ASR模型加载失败:', error);
    self.postMessage({
      status: 'error',
      error: error instanceof Error ? error.message : '模型加载失败',
    } satisfies ASRProgress);
  }
}

/**
 * 运行 ASR 识别
 */
async function run({ audio, language }: { audio: Float32Array; language: string }) {
  console.log('ASR Worker开始识别:', { audioLength: audio?.length, language });
  
  try {
    if (!activeConfig) {
      throw new Error('模型配置缺失，请先加载模型');
    }

    const transcriber = await PipelineSingleton.getInstance(activeConfig);
    const start = performance.now();

    self.postMessage({
      status: 'running',
      data: `正在进行语音识别 (${activeConfig.family})...`,
    } satisfies ASRProgress);

    // 确保语言代码正确；Moonshine 仅支持英文，强制 'en'
    let validLanguage = isValidLanguageCode(language) ? language : 'en';
    if (activeConfig.family === 'moonshine') {
      validLanguage = 'en';
    }
    console.log('ASR使用语言:', { original: language, valid: validLanguage, family: activeConfig.family });

    // 按模型族构造识别选项：
    // - Whisper 支持 language / chunk_length_s / return_timestamps（chunk_length_s=30，避免 Web 端短窗强切）
    // - Moonshine 支持 return_timestamps，不传 language 与 chunk_length_s（按整段处理）
    const opts: Record<string, unknown> = { return_timestamps: true };
    if (activeConfig.family === 'whisper') {
      opts.language = validLanguage;
      opts.chunk_length_s = 30;
    }

    const result = await transcriber(audio, opts);

    const end = performance.now();
    logAsrModelOutput(result as Record<string, unknown>, {
      source: 'transformers-worker',
      stage: 'pipeline 原始输出',
    });

    // 处理结果，生成句子级别的字幕片段
    let chunks: Array<{ text: string; timestamp: [number, number]; id: string; selected: boolean }> = [];
    let duration = 0;
    
    if (result.chunks && Array.isArray(result.chunks)) {
      // Whisper base 模型返回句子级别的chunks
      chunks = result.chunks.map((chunk: { text: string; timestamp: [number, number] }, index: number) => ({
        text: chunk.text.trim(),
        timestamp: chunk.timestamp,
        id: `sentence-${index}`,
        selected: false,
      }));
      duration = Math.max(...result.chunks.map((c: { timestamp: [number, number] }) => c.timestamp[1]));
    } else if (result.text) {
      // 如果没有chunks，创建单个片段
      chunks = [{
        text: result.text.trim(),
        timestamp: [0, duration || 0] as [number, number],
        id: 'sentence-0',
        selected: false,
      }];
    }

    const transcript: SubtitleTranscript = {
      text: result.text,
      chunks,
      language: activeConfig.family === 'moonshine' ? 'en' : validLanguage,
      duration,
    };

    logAsrModelOutput(transcript, {
      source: 'transformers-worker',
      stage: '转写结果',
    });

    self.postMessage({ 
      status: 'complete', 
      result: transcript, 
      time: end - start 
    } satisfies ASRProgress);
    
  } catch (error) {
    console.error('ASR识别失败:', error);
    self.postMessage({
      status: 'error',
      error: error instanceof Error ? error.message : 'ASR 识别失败',
    } satisfies ASRProgress);
  }
}

// 监听主线程消息
self.addEventListener('message', async (e) => {
  console.log('ASR Worker接收消息:', e.data);
  const { type, data } = e.data;

  switch (type) {
    case 'download':
      await downloadModelOnly(data);
      break;

    case 'load':
      await load(data);
      break;

    case 'run':
      await run(data);
      break;

    default:
      console.error('未知的ASR Worker消息类型:', e.data);
      self.postMessage({
        status: 'error',
        error: `未知的消息类型: ${type}`,
      } satisfies ASRProgress);
      break;
  }
});

export {}; // 确保这是一个模块