import type { ASRProgress, SubtitleTranscript } from '@/types/subtitle';
import asrWorker from '@/workers/asrWorker.ts?worker&inline';

export type ASRDevice = 'webgpu' | 'wasm';

export interface TransformersASREngineConfig {
  modelId: string;
  modelBaseUrl?: string;
  device: ASRDevice;
  language: string;
}

export const DEFAULT_TRANSFORMERS_ASR_CONFIG: TransformersASREngineConfig = {
  modelId: 'onnx-community/whisper-small',
  modelBaseUrl: 'https://fly-cut.oss-cn-hangzhou.aliyuncs.com/models/onnx-community/whisper-small',
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
      nextConfig.device !== this.config.device;

    this.config = nextConfig;

    if (needsReload) {
      this.isModelLoaded = false;
      this.destroyWorker();
    }
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
