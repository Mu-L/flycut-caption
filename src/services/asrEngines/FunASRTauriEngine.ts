import { invoke } from '@tauri-apps/api/core';
import type { ASRProgress, SubtitleTranscript } from '@/types/subtitle';
import { logAsrModelOutput } from '@/utils/asrOutputLog';

interface FunASREnvironmentStatus {
  modelReady: boolean;
  missingModelFiles: string[];
  modelError?: string | null;
  sidecarReady: boolean;
  sidecarError?: string | null;
}

export class FunASRTauriEngine {
  private progressCallbacks = new Set<(progress: ASRProgress) => void>();

  setProgressCallback(callback: (progress: ASRProgress) => void) {
    this.progressCallbacks.clear();
    this.progressCallbacks.add(callback);
  }

  addProgressCallback(callback: (progress: ASRProgress) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  private emitProgress(progress: ASRProgress) {
    for (const callback of this.progressCallbacks) {
      callback(progress);
    }
  }

  async loadModel(modelId?: string): Promise<void> {
    this.emitProgress({ status: 'loading', data: '检查 FunASR 模型和运行程序...' });

    const status = await invoke<FunASREnvironmentStatus>('check_funasr_environment', {
      modelId,
    });

    if (!status.modelReady) {
      const missing = status.missingModelFiles.length > 0
        ? `缺少 ${status.missingModelFiles.join(', ')}`
        : status.modelError || '模型不可用';
      throw new Error(`FunASR 模型文件不完整：${missing}。请先下载完整模型。`);
    }

    if (!status.sidecarReady) {
      throw new Error(status.sidecarError || 'FunASR 运行程序缺失：缺少 funasr-asr sidecar 可执行文件。');
    }

    this.emitProgress({ status: 'loaded' });
  }

  isReady(): boolean {
    return true;
  }

  async transcribe(
    input: { path?: string; buffer?: ArrayBuffer }, 
    language: string,
    modelId?: string
  ): Promise<SubtitleTranscript> {
    if (!input.path) {
      throw new Error('Tauri 引擎需要本地文件路径');
    }

    this.emitProgress({
      status: 'running',
      data: '正在使用 FunASR 本地引擎识别，长视频可能需要等待...',
    });

    const result = await invoke<SubtitleTranscript>('transcribe_with_funasr', {
      inputPath: input.path,
      language,
      modelId,
    });

    logAsrModelOutput(result, {
      source: 'funasr-tauri',
      stage: 'sidecar 返回',
    });

    this.emitProgress({ status: 'complete', result });
    return result;
  }

  destroy(): void {
    this.progressCallbacks.clear();
  }
}
