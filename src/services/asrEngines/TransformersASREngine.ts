import type { ASRProgress, SubtitleTranscript } from '@/types/subtitle';
import asrWorker from '@/workers/asrWorker.ts?worker&inline';
import {
  DEFAULT_WEB_MODEL_ID,
  getWebAsrModel,
} from '@/config/webAsrModels';

export type ASRDevice = 'webgpu' | 'wasm';

export interface TransformersASREngineConfig {
  /** HuggingFace / OSS 仓库 id，例如 onnx-community/whisper-small */
  modelId: string;
  /** 自建 OSS 镜像前缀；未设置时直接从 HuggingFace 下载 */
  modelBaseUrl?: string;
  /** 模型族，决定 worker 内的 dtype / 时间戳策略 */
  family: 'whisper' | 'moonshine';
  device: ASRDevice;
  language: string;
}

// 默认配置：使用推荐的 Web 模型（whisper-small）
const DEFAULT_WEB_MODEL = getWebAsrModel(DEFAULT_WEB_MODEL_ID)!;

export const DEFAULT_TRANSFORMERS_ASR_CONFIG: TransformersASREngineConfig = {
  modelId: DEFAULT_WEB_MODEL.modelId,
  modelBaseUrl: DEFAULT_WEB_MODEL.modelBaseUrl,
  family: DEFAULT_WEB_MODEL.family,
  device: 'wasm',
  language: 'en',
};

export class TransformersASREngine {
  private worker: Worker | null = null;
  private config: TransformersASREngineConfig = DEFAULT_TRANSFORMERS_ASR_CONFIG;
  private isModelLoaded = false;
  private onProgress: ((progress: ASRProgress) => void) | null = null;

  public setProgressCallback(callback: (progress: ASRProgress) => void) {
    this.onProgress = callback;
  }

  public setConfig(config: Partial<TransformersASREngineConfig>) {
    const nextConfig = { ...this.config, ...config };
    const needsReload =
      nextConfig.modelId !== this.config.modelId ||
      nextConfig.modelBaseUrl !== this.config.modelBaseUrl ||
      nextConfig.family !== this.config.family ||
      nextConfig.device !== this.config.device;

    this.config = nextConfig;

    if (needsReload) {
      this.isModelLoaded = false;
      this.destroyWorker();
    }
  }

  /**
   * 按 Web 短 id 设置模型（例如 'whisper-small' / 'moonshine-tiny'）。
   * 将查阅 webAsrModels 清单，转换为 HF modelId / modelBaseUrl / family。
   */
  public setWebModel(webModelId: string) {
    const meta = getWebAsrModel(webModelId);
    if (!meta) {
      throw new Error(`未知的 Web ASR 模型: ${webModelId}`);
    }
    this.setConfig({
      modelId: meta.modelId,
      modelBaseUrl: meta.modelBaseUrl,
      family: meta.family,
    });
  }

  public getConfig(): TransformersASREngineConfig {
    return this.config;
  }

  public isReady(): boolean {
    return this.isModelLoaded;
  }

  public async loadModel(): Promise<void> {
    const worker = this.getWorker();

    return new Promise((resolve, reject) => {
      const finish = this.listenOnce((progress) => {
        if (progress.status === 'loaded') {
          this.isModelLoaded = true;
          finish();
          resolve();
        } else if (progress.status === 'error') {
          this.isModelLoaded = false;
          finish();
          reject(new Error(progress.error || '模型加载失败'));
        }
      });

      worker.postMessage({
        type: 'load',
        data: { config: this.config },
      });
    });
  }

  public async transcribe(audio: Float32Array, language?: string): Promise<SubtitleTranscript> {
    if (!this.isModelLoaded) {
      throw new Error('模型未准备好，请先调用 prepareModel()');
    }

    const worker = this.getWorker();
    const runLanguage = language || this.config.language;

    return new Promise((resolve, reject) => {
      const finish = this.listenOnce((progress) => {
        if (progress.status === 'complete' && progress.result) {
          finish();
          resolve(progress.result);
        } else if (progress.status === 'error') {
          finish();
          reject(new Error(progress.error || 'ASR 识别失败'));
        }
      });

      worker.postMessage({
        type: 'run',
        data: { audio, language: runLanguage },
      });
    });
  }

  public destroy() {
    this.destroyWorker();
    this.onProgress = null;
    this.isModelLoaded = false;
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new asrWorker();

      this.worker.onmessage = (event) => {
        const progress = event.data as ASRProgress;
        this.onProgress?.(progress);
      };

      this.worker.onerror = () => {
        this.onProgress?.({
          status: 'error',
          error: 'Worker 运行错误',
        });
      };
    }

    return this.worker;
  }

  private destroyWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private listenOnce(listener: (progress: ASRProgress) => void): () => void {
    const originalCallback = this.onProgress;

    this.onProgress = (progress) => {
      originalCallback?.(progress);
      listener(progress);
    };

    return () => {
      this.onProgress = originalCallback;
    };
  }
}