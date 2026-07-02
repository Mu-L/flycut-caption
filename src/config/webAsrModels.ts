import type { ModelTimestampDto } from '@/types/model';

// Web 端（浏览器 Transformers.js）ASR 模型清单
// 与 Tauri 客户端的 models.json 完全独立，仅服务于浏览器引擎。
// 每个 model 的 `id` 是前端引用用的短 id，`modelId` 是 HuggingFace / OSS 的实际仓库 id。
// `modelBaseUrl` 可选：设置后会拦截 huggingface.co 请求并重定向到自建 OSS 镜像
// （见 asrWorker.ts 中的 fetch 重写），加速国内下载。未设置时直接从 HuggingFace 拉取。

export interface WebAsrModelFamily {
  /** 前端分组用的人类可读名称 */
  label: string;
}

export const WEB_MODEL_FAMILY_LABELS: Record<string, string> = {
  whisper: 'Whisper 多语种',
  moonshine: 'Moonshine 英文轻量',
};

export interface WebAsrModel {
  /** 前端引用的短 id */
  id: string;
  /** 下拉显示名称 */
  name: string;
  /** 模型族，用于分组与 worker 内部适配 */
  family: 'whisper' | 'moonshine';
  /** HuggingFace / OSS 仓库 id（传给 transformers.js pipeline） */
  modelId: string;
  /** 自建 OSS 镜像前缀，未设置时直接从 HuggingFace 下载 */
  modelBaseUrl?: string;
  /** 支持的语言列表，['multi'] 表示多语种，['en'] 表示仅英文 */
  languages: string[];
  /** 是否推荐 */
  recommended: boolean;
  /** 是否已通过 smoke test 验证 token/word 级时间戳（用于按字词删除能力提示） */
  tokenTimestampVerified: boolean;
  /** 体积提示文案 */
  sizeHint: string;
  /** 简介 */
  description: string;
}

// 注意：Whisper 的 modelBaseUrl 已上传至自建 OSS；Moonshine 暂未上传 OSS 镜像，
// 用户首次下载会直接从 huggingface.co 拉取（国内可能较慢），后续可补传。
export const WEB_ASR_MODELS: WebAsrModel[] = [
  {
    id: 'whisper-tiny',
    name: 'Whisper Tiny',
    family: 'whisper',
    modelId: 'onnx-community/whisper-tiny',
    modelBaseUrl:
      'https://fly-cut.oss-cn-hangzhou.aliyuncs.com/models/onnx-community/whisper-tiny',
    languages: ['multi'],
    recommended: false,
    tokenTimestampVerified: true,
    sizeHint: '~75MB (q8)',
    description: '最轻量的 Whisper，速度最快，精度较低，适合实时预览。',
  },
  {
    id: 'whisper-base',
    name: 'Whisper Base',
    family: 'whisper',
    modelId: 'onnx-community/whisper-base',
    modelBaseUrl:
      'https://fly-cut.oss-cn-hangzhou.aliyuncs.com/models/onnx-community/whisper-base',
    languages: ['multi'],
    recommended: false,
    tokenTimestampVerified: true,
    sizeHint: '~145MB (q8)',
    description: 'Whisper Base，速度与精度的折中。',
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    family: 'whisper',
    modelId: 'onnx-community/whisper-small',
    modelBaseUrl:
      'https://fly-cut.oss-cn-hangzhou.aliyuncs.com/models/onnx-community/whisper-small',
    languages: ['multi'],
    recommended: true,
    tokenTimestampVerified: true,
    sizeHint: '~244MB (q8)',
    description: '推荐：多语种支持好，浏览器本地可用，WASM/WebGPU 均可。',
  },
  {
    id: 'moonshine-tiny',
    name: 'Moonshine Tiny',
    family: 'moonshine',
    modelId: 'onnx-community/moonshine-tiny-int8',
    languages: ['en'],
    recommended: false,
    tokenTimestampVerified: false,
    sizeHint: '~27MB (int8)',
    description: 'Useful Sense 出品的英文轻量模型，体积小速度快，仅英文。',
  },
  {
    id: 'moonshine-base',
    name: 'Moonshine Base',
    family: 'moonshine',
    modelId: 'onnx-community/moonshine-base-int8',
    languages: ['en'],
    recommended: false,
    tokenTimestampVerified: false,
    sizeHint: '~64MB (int8)',
    description: 'Moonshine Base，英文识别精度更好，体积仍很小。',
  },
];

export function getWebModelTimestamp(modelId: string): ModelTimestampDto | undefined {
  const model = WEB_ASR_MODELS.find((entry) => entry.id === modelId);
  if (!model) return undefined;
  return {
    level: model.tokenTimestampVerified ? 'token' : 'segment',
    source: model.tokenTimestampVerified ? 'model' : 'vad',
    token_timestamp_verified: model.tokenTimestampVerified,
  };
}

// 默认 Web 模型 id
export const DEFAULT_WEB_MODEL_ID = 'whisper-small';

/** 按 id 查找 Web 模型定义 */
export function getWebAsrModel(id: string): WebAsrModel | undefined {
  return WEB_ASR_MODELS.find((m) => m.id === id);
}

/** 按 HuggingFace modelId 反查（用于从 engine config 反推 family 等信息） */
export function findWebAsrModelByHFModelId(
  hfModelId: string,
): WebAsrModel | undefined {
  return WEB_ASR_MODELS.find((m) => m.modelId === hfModelId);
}