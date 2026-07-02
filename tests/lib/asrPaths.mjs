import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_ID = 'com.flycut.caption';
export const DEFAULT_MODEL_ID = 'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17';

export function projectRoot() {
  return join(import.meta.dirname, '..', '..');
}

export function resolveDemoMp4(root = projectRoot()) {
  return join(root, 'src', 'assets', 'demo.mp4');
}

export function resolveSidecar(root = projectRoot()) {
  const path = join(root, 'src-tauri', 'binaries', 'funasr-asr');
  return existsSync(path) ? path : null;
}

export function resolveFfmpeg(root = projectRoot()) {
  const path = join(root, 'src-tauri', 'binaries', 'ffmpeg');
  return existsSync(path) ? path : null;
}

export function resolveVadModel(root = projectRoot()) {
  const bundled = join(root, 'src-tauri', 'shared_assets', 'silero-vad', 'silero_vad.onnx');
  if (existsSync(bundled)) return bundled;

  const appData = defaultAppDataDir();
  if (appData) {
    const cached = join(appData, 'shared_assets', 'silero-vad', 'silero_vad.onnx');
    if (existsSync(cached)) return cached;
  }

  return null;
}

export function resolveFsmnVadDir(root = projectRoot()) {
  const required = ['model.onnx', 'vad.mvn', 'vad.yaml'];
  const checkDir = (dir) =>
    required.every((file) => existsSync(join(dir, file))) ? dir : null;

  const bundled = join(root, 'src-tauri', 'shared_assets', 'funasr-fsmn-vad');
  const bundledOk = checkDir(bundled);
  if (bundledOk) return bundledOk;

  const appData = defaultAppDataDir();
  if (appData) {
    const cached = join(appData, 'shared_assets', 'funasr-fsmn-vad');
    const cachedOk = checkDir(cached);
    if (cachedOk) return cachedOk;
  }

  return null;
}

function defaultAppDataDir() {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', APP_ID);
    case 'win32':
      return process.env.APPDATA
        ? join(process.env.APPDATA, 'FlyCut Caption')
        : null;
    default:
      return process.env.XDG_DATA_HOME
        ? join(process.env.XDG_DATA_HOME, APP_ID)
        : join(home, '.local', 'share', APP_ID);
  }
}

export function resolveModelDir(modelId = DEFAULT_MODEL_ID, root = projectRoot()) {
  // 全局目录覆盖仅在与 ASR_TEST_MODEL_ID 匹配（或未指定）时生效，避免 family 测试误用其他模型目录
  if (process.env.ASR_TEST_MODEL_DIR && existsSync(process.env.ASR_TEST_MODEL_DIR)) {
    const overrideModelId = process.env.ASR_TEST_MODEL_ID;
    if (!overrideModelId || overrideModelId === modelId) {
      return process.env.ASR_TEST_MODEL_DIR;
    }
  }

  const appData = defaultAppDataDir();
  if (appData) {
    const cached = join(appData, 'models', modelId);
    if (existsSync(cached)) return cached;
  }

  const bundled = join(root, 'src-tauri', 'models', modelId);
  if (existsSync(bundled)) return bundled;

  return null;
}

export function loadManifest(root = projectRoot()) {
  const manifestPath = join(root, 'models.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function loadModelFromManifest(modelId = DEFAULT_MODEL_ID, root = projectRoot()) {
  const manifest = loadManifest(root);
  const model = manifest.models.find((entry) => entry.id === modelId);
  if (!model) {
    throw new Error(`Model ${modelId} not found in models.json`);
  }
  return model;
}

/** 每个 model family 选一个代表模型（优先 recommended） */
export function representativeModelsByFamily(root = projectRoot()) {
  const manifest = loadManifest(root);
  const byFamily = new Map();

  for (const model of manifest.models) {
    if (!model.enabled) continue;
    const existing = byFamily.get(model.family);
    if (!existing || (model.recommended && !existing.recommended)) {
      byFamily.set(model.family, model);
    }
  }

  return [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, model]) => ({ family, model }));
}

/** 各 family 集成测试默认识别语言 */
export const FAMILY_LANGUAGES = {
  sense_voice: 'zh',
  paraformer: 'zh',
  moonshine: 'en',
  whisper: 'en',
  telespeech_ctc: 'zh',
  zipformer_ctc: 'zh',
  nemo_transducer: 'en',
  fire_red_asr: 'zh',
};