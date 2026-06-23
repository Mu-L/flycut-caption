import type { ASRProgress, SubtitleTranscript } from '../types/subtitle';
import { processAudioForASR, hasWebGPU } from '../utils/audioUtils';
import {
  DEFAULT_TRANSFORMERS_ASR_CONFIG,
  TransformersASREngine,
  type ASRDevice,
  type TransformersASREngineConfig,
} from './asrEngines/TransformersASREngine';

export class ASRService {
  private engine = new TransformersASREngine();
  private currentDevice: ASRDevice = DEFAULT_TRANSFORMERS_ASR_CONFIG.device;

  constructor() {
    console.log('ASR Service初始化');
    this.init();
  }

  /**
   * 初始化服务
   */
  private async init() {
    // 检测设备能力
    const supportsWebGPU = await hasWebGPU();
    this.currentDevice = supportsWebGPU ? 'webgpu' : 'wasm';
    this.engine.setConfig({ device: this.currentDevice });
    console.log('ASR设备检测结果:', { supportsWebGPU, currentDevice: this.currentDevice });
  }

  /**
   * 设置进度回调
   */
  public setProgressCallback(callback: (progress: ASRProgress) => void) {
    this.engine.setProgressCallback(callback);
  }

  public configure(config: Partial<TransformersASREngineConfig>) {
    this.engine.setConfig(config);
    this.currentDevice = this.engine.getConfig().device;
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
      this.engine.setConfig({ device });
    }
  }

  /**
   * 加载模型
   */
  public async loadModel(): Promise<void> {
    console.log('ASR开始加载模型:', this.currentDevice);
    await this.engine.loadModel();
    console.log('ASR模型加载完成');
  }

  /**
   * 准备模型（分步操作第一步）
   */
  public async prepareModel(): Promise<void> {
    console.log('ASR准备模型:', this.currentDevice);

    if (!this.engine.isReady()) {
      console.log('ASR开始加载模型');
      await this.loadModel();
    } else {
      console.log('ASR模型已加载，跳过准备步骤');
    }
  }

  /**
   * 识别音频（分步操作第二步）
   */
  public async transcribeAudio(
    audioBuffer: ArrayBuffer,
    language: string = 'en'
  ): Promise<SubtitleTranscript> {
    console.log('ASR开始转录:', { bufferSize: audioBuffer.byteLength, language });
    
    // 检查模型是否已准备好
    if (!this.engine.isReady()) {
      throw new Error('模型未准备好，请先调用 prepareModel()');
    }

    this.engine.setConfig({ language });

    // 处理音频数据
    const audioData = await processAudioForASR(audioBuffer);
    console.log('ASR音频数据处理完成:', { audioDataLength: audioData.length });

    console.log('ASR发送识别消息:', { audioLength: audioData.length, language });
    return this.engine.transcribe(audioData, language);
  }

  /**
   * 一键识别（兼容原有接口）
   */
  public async transcribeAudioWithAutoLoad(
    audioBuffer: ArrayBuffer,
    language: string = 'en'
  ): Promise<SubtitleTranscript> {
    await this.prepareModel();
    return this.transcribeAudio(audioBuffer, language);
  }

  /**
   * 检查模型是否已加载
   */
  public isReady(): boolean {
    return this.engine.isReady();
  }

  /**
   * 销毁服务
   */
  public destroy() {
    console.log('ASR销毁服务');
    this.engine.destroy();
  }
}

// 全局单例
export const asrService = new ASRService();
