import type { ASRProgress, SubtitleTranscript } from '../types/subtitle';
import { processAudioForASR, hasWebGPU } from '../utils/audioUtils';
import {
  DEFAULT_TRANSFORMERS_ASR_CONFIG,
  TransformersASREngine,
  type ASRDevice,
  type TransformersASREngineConfig,
} from './asrEngines/TransformersASREngine';
import { FunASRTauriEngine } from './asrEngines/FunASRTauriEngine';

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
   * 设置进度回调
   */
  public setProgressCallback(callback: (progress: ASRProgress) => void) {
    this.transformersEngine.setProgressCallback(callback);
    this.funasrTauriEngine.setProgressCallback(callback);
  }

  public configure(config: Partial<TransformersASREngineConfig>) {
    if (this.currentEngineType === 'transformers') {
      this.transformersEngine.setConfig(config);
      this.currentDevice = this.transformersEngine.getConfig().device;
    }
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
   */
  public async loadModel(modelId?: string): Promise<void> {
    console.log('ASR开始加载模型:', this.currentEngineType, this.currentDevice);
    if (this.currentEngineType === 'funasr-tauri') {
      await this.funasrTauriEngine.loadModel(modelId);
    } else {
      await this.transformersEngine.loadModel();
    }
    console.log('ASR模型加载完成');
  }

  /**
   * 准备模型（分步操作第一步）
   */
  public async prepareModel(modelId?: string): Promise<void> {
    const engine = this.getEngine();
    console.log('ASR准备模型:', this.currentEngineType);

    if (this.currentEngineType === 'funasr-tauri') {
      await this.loadModel(modelId);
      return;
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

    return this.funasrTauriEngine.transcribe({ path: inputPath }, language, modelId);
  }

  /**
   * 一键识别（兼容原有接口）
   */
  public async transcribeAudioWithAutoLoad(
    audioBuffer: ArrayBuffer,
    language: string = 'en',
    modelId?: string
  ): Promise<SubtitleTranscript> {
    await this.prepareModel();
    return this.transcribeAudio(audioBuffer, language, modelId);
  }

  /**
   * 检查模型是否已加载
   */
  public isReady(): boolean {
    return this.getEngine().isReady();
  }

  /**
   * 检查 Whisper 模型是否已加载（当前会话）
   */
  public isWhisperReady(): boolean {
    return this.transformersEngine.isReady();
  }

  /**
   * 预下载 Whisper 模型（不影响当前引擎选择）
   * 进度通过 progressCallback 返回
   */
  public async preloadWhisperModel(device?: ASRDevice): Promise<void> {
    if (device) {
      this.transformersEngine.setConfig({ device });
    }
    // 保存当前回调，确保进度能传到调用方
    await this.transformersEngine.loadModel();
  }

  /**
   * 为 Whisper 预下载设置进度回调
   */
  public setWhisperProgressCallback(callback: (progress: ASRProgress) => void) {
    this.transformersEngine.setProgressCallback(callback);
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

// 全局单例
export const asrService = new ASRService();
