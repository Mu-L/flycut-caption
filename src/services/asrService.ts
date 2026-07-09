import type { ASRProgress, SubtitleTranscript } from '../types/subtitle';
import { processAudioForASR, hasWebGPU } from '../utils/audioUtils';
import {
  DEFAULT_TRANSFORMERS_ASR_CONFIG,
  TransformersASREngine,
  type ASRDevice,
  type TransformersASREngineConfig,
} from './asrEngines/TransformersASREngine';
import { FunASRTauriEngine } from './asrEngines/FunASRTauriEngine';
import {
  checkAllWebModelsDownloaded,
  isWebModelDownloaded,
  markWebModelDownloaded,
} from './webModelCache';
import { resolveFunasrModelId } from '@/utils/asrModelId';

export type ASREngineType = 'transformers' | 'funasr-tauri';

export class ASRService {
  private transformersEngine = new TransformersASREngine();
  private funasrTauriEngine = new FunASRTauriEngine();
  private currentEngineType: ASREngineType = 'transformers';
  private currentDevice: ASRDevice = DEFAULT_TRANSFORMERS_ASR_CONFIG.device;

  constructor() {
    console.log('ASR Service初始化');
    this.init();
  }

  /**
   * 初始化服务
   */
  private async init() {
    const supportsWebGPU = await hasWebGPU();
    this.currentDevice = supportsWebGPU ? 'webgpu' : 'wasm';
    this.transformersEngine.setConfig({ device: this.currentDevice });
    console.log('ASR设备检测结果:', { supportsWebGPU, currentDevice: this.currentDevice });
  }

  /**
   * 获取当前使用的引擎实例
   */
  private getEngine() {
    if (this.currentEngineType === 'funasr-tauri') return this.funasrTauriEngine;
    return this.transformersEngine;
  }

  /**
   * 设置引擎类型
   */
  setEngineType(engineType: ASREngineType) {
    if (this.currentEngineType !== engineType) {
      console.log('ASR引擎切换:', this.currentEngineType, '->', engineType);
      this.currentEngineType = engineType;
    }
  }

  /**
   * 获取当前引擎类型
   */
  getEngineType(): ASREngineType {
    return this.currentEngineType;
  }

  /**
   * 设置进度回调（会替换已有主回调）
   */
  public setProgressCallback(callback: (progress: ASRProgress) => void) {
    this.transformersEngine.setProgressCallback(callback);
    this.funasrTauriEngine.setProgressCallback(callback);
  }

  /**
   * 追加进度回调（不覆盖其他监听方，如下载面板与 ASR 主流程可并存）
   */
  public addProgressCallback(callback: (progress: ASRProgress) => void): () => void {
    const offTransformers = this.transformersEngine.addProgressCallback(callback);
    const offFunasr = this.funasrTauriEngine.addProgressCallback(callback);
    return () => {
      offTransformers();
      offFunasr();
    };
  }

  public configure(config: Partial<TransformersASREngineConfig>) {
    if (this.currentEngineType === 'transformers') {
      this.transformersEngine.setConfig(config);
      this.currentDevice = this.transformersEngine.getConfig().device;
    }
  }

  /**
   * 设置 Web (Transformers) 引擎当前要使用的模型（按 Web 短 id）
   * 例如 'whisper-small' / 'moonshine-tiny'。会触发下次 loadModel 时重新加载。
   */
  public setWebModel(webModelId: string) {
    this.transformersEngine.setWebModel(webModelId);
  }

  /**
   * 获取当前设备类型
   */
  public getCurrentDevice(): ASRDevice {
    return this.currentDevice;
  }

  /**
   * 设置设备类型
   */
  public setDevice(device: ASRDevice) {
    if (this.currentDevice !== device) {
      console.log('ASR设备类型变更:', this.currentDevice, '->', device);
      this.currentDevice = device;
      this.transformersEngine.setConfig({ device });
    }
  }

  /**
   * 加载模型
   * - transformers 引擎：modelId 为 Web 短 id（可选，会先 setWebModel 再 loadModel）
   * - funasr-tauri 引擎：modelId 为 manifest 中的模型 id
   */
  public async loadModel(modelId?: string): Promise<void> {
    console.log('ASR开始加载模型:', this.currentEngineType, this.currentDevice, modelId);
    if (this.currentEngineType === 'funasr-tauri') {
      const funasrModelId = resolveFunasrModelId(modelId);
      await this.funasrTauriEngine.loadModel(funasrModelId);
    } else {
      if (modelId) {
        this.transformersEngine.setWebModel(modelId);
      }
      await this.transformersEngine.loadModel();
    }
    console.log('ASR模型加载完成');
  }

  /**
   * 准备模型（分步操作第一步）
   */
  public async prepareModel(modelId?: string): Promise<void> {
    const engine = this.getEngine();
    console.log('ASR准备模型:', this.currentEngineType, modelId);

    if (this.currentEngineType === 'funasr-tauri') {
      await this.loadModel(modelId);
      return;
    }

    // transformers：若调用方指定的模型与当前已加载的不同，需要重新加载
    if (modelId) {
      const currentConfig = this.transformersEngine.getConfig();
      const currentHFId = currentConfig.modelId;
      const targetMeta = WEB_ASR_MODEL_LOOKUP[modelId];
      if (targetMeta && targetMeta.modelId !== currentHFId) {
        this.transformersEngine.setWebModel(modelId);
        // 切换模型后视为未加载，强制走 loadModel 分支
        await this.loadModel();
        return;
      }
    }

    if (!engine.isReady()) {
      console.log('ASR开始加载模型');
      await this.loadModel(modelId);
    } else {
      console.log('ASR模型已加载，跳过准备步骤');
    }
  }

  /**
   * 识别音频（分步操作第二步）
   */
  public async transcribeAudio(
    audioBuffer: ArrayBuffer,
    language: string = 'en',
    modelId?: string
  ): Promise<SubtitleTranscript> {
    const engine = this.getEngine();
    console.log('ASR开始转录:', { engineType: this.currentEngineType, bufferSize: audioBuffer.byteLength, language, modelId });

    if (!engine.isReady()) {
      throw new Error('模型未准备好，请先调用 prepareModel()');
    }

    if (this.currentEngineType === 'transformers') {
      this.transformersEngine.setConfig({ language });
      const audioData = await processAudioForASR(audioBuffer);
      console.log('ASR音频数据处理完成:', { audioDataLength: audioData.length });
      return this.transformersEngine.transcribe(audioData, language);
    }

    // funasr-tauri
    return this.funasrTauriEngine.transcribe(
      { buffer: audioBuffer },
      language,
      modelId
    );
  }

  /**
   * Tauri 引擎专用：使用文件路径直接识别
   */
  public async transcribeWithPath(
    inputPath: string, 
    language: string = 'en',
    modelId?: string
  ): Promise<SubtitleTranscript> {
    if (this.currentEngineType !== 'funasr-tauri') {
      throw new Error('transcribeWithPath 仅在 funasr-tauri 引擎下可用');
    }

    return this.funasrTauriEngine.transcribe(
      { path: inputPath },
      language,
      resolveFunasrModelId(modelId),
    );
  }

  /**
   * 一键识别（兼容原有接口）
   */
  public async transcribeAudioWithAutoLoad(
    audioBuffer: ArrayBuffer,
    language: string = 'en',
    modelId?: string
  ): Promise<SubtitleTranscript> {
    await this.prepareModel(modelId);
    return this.transcribeAudio(audioBuffer, language, modelId);
  }

  /**
   * 检查模型是否已加载
   */
  public isReady(): boolean {
    return this.getEngine().isReady();
  }

  /**
   * 检查当前 Web (Transformers) 模型是否已加载（当前会话）
   */
  public isWhisperReady(): boolean {
    return this.transformersEngine.isReady();
  }

  /**
   * 检查指定 Web 模型是否已下载到浏览器缓存
   */
  public async isWebModelDownloaded(webModelId: string): Promise<boolean> {
    return isWebModelDownloaded(webModelId);
  }

  /**
   * 返回所有已下载的 Web 模型短 id
   */
  public async checkAllWebModelsDownloaded(): Promise<string[]> {
    return checkAllWebModelsDownloaded();
  }

  /**
   * 下载 Web 模型到浏览器缓存（不加载到内存，不触发识别）
   */
  public async downloadWebModel(webModelId: string, device?: ASRDevice): Promise<void> {
    const meta = WEB_ASR_MODEL_LOOKUP[webModelId];
    if (!meta) {
      throw new Error(`未知的 Web ASR 模型: ${webModelId}`);
    }
    const fullMeta = getWebAsrModel(webModelId);
    if (!fullMeta) {
      throw new Error(`未知的 Web ASR 模型: ${webModelId}`);
    }

    const config: TransformersASREngineConfig = {
      modelId: fullMeta.modelId,
      modelBaseUrl: fullMeta.modelBaseUrl,
      family: fullMeta.family,
      device: device ?? this.transformersEngine.getConfig().device,
      language: 'en',
    };

    await this.transformersEngine.downloadModelWithConfig(config);
    markWebModelDownloaded(webModelId);
  }

  /**
   * 为 Web 模型预下载追加进度回调（不覆盖 ASR 主流程回调）
   */
  public addWhisperProgressCallback(callback: (progress: ASRProgress) => void): () => void {
    return this.addProgressCallback(callback);
  }

  /**
   * 销毁服务
   */
  public destroy() {
    console.log('ASR销毁服务');
    this.transformersEngine.destroy();
    this.funasrTauriEngine.destroy();
  }
}

// 内部：Web 短 id → 模型元信息，避免 service 层循环依赖
import { getWebAsrModel, WEB_ASR_MODELS } from '@/config/webAsrModels';
const WEB_ASR_MODEL_LOOKUP: Record<string, { modelId: string }> = Object.fromEntries(
  WEB_ASR_MODELS.map((m) => [m.id, { modelId: m.modelId }]),
);

// 全局单例
export const asrService = new ASRService();