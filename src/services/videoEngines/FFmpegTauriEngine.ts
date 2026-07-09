import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  IVideoProcessingEngine,
  VideoEngineType,
  EngineCapabilities,
  VideoProcessingOptions,
} from '@/types/videoEngine';
import type { VideoFile, VideoSegment, VideoProcessingProgress } from '@/types/video';
import type { SubtitleChunk } from '@/types/subtitle';
import { buildBurnAssContent, buildBurnTextSubtitleContent } from '@/subtitle/burnAss';

interface ProcessVideoResult {
  outputPath: string;
}

interface ProgressPayload {
  stage?: string;
  progress?: number;
  message?: string;
}

export class FFmpegTauriEngine implements IVideoProcessingEngine {
  readonly name = 'FFmpeg (Tauri Native)';
  readonly type: VideoEngineType = 'ffmpeg-tauri';
  readonly version = 'native';

  private videoFile: VideoFile | null = null;
  private onProgress?: (progress: VideoProcessingProgress) => void;
  private unlisten: UnlistenFn | null = null;
  private videoWidth = 1920;
  private videoHeight = 1080;

  async checkCapabilities(): Promise<EngineCapabilities> {
    try {
      const status = await invoke<{ available: boolean; error?: string }>('check_ffmpeg_environment');
      if (!status.available) {
        return {
          supported: false,
          reason: status.error ?? '未检测到 ffmpeg',
          formats: [],
          features: {
            trimming: false,
            concatenation: false,
            audioProcessing: false,
            subtitleBurning: false,
            qualityControl: false,
          },
        };
      }

      return {
        supported: true,
        formats: ['mp4', 'webm', 'mov', 'mkv'],
        features: {
          trimming: true,
          concatenation: true,
          audioProcessing: true,
          subtitleBurning: true,
          qualityControl: true,
        },
      };
    } catch (error) {
      return {
        supported: false,
        reason: error instanceof Error ? error.message : 'FFmpeg 环境检查失败',
        formats: [],
        features: {
          trimming: false,
          concatenation: false,
          audioProcessing: false,
          subtitleBurning: false,
          qualityControl: false,
        },
      };
    }
  }

  async initialize(
    videoFile: VideoFile,
    onProgress?: (progress: VideoProcessingProgress) => void,
  ): Promise<void> {
    if (!videoFile.path) {
      throw new Error('Tauri FFmpeg 引擎需要本地视频路径，请通过原生文件选择器上传');
    }

    this.videoFile = videoFile;
    this.onProgress = onProgress;

    if (this.unlisten) {
      await this.unlisten();
      this.unlisten = null;
    }

    this.unlisten = await listen<ProgressPayload>('video-process-progress', (event) => {
      const payload = event.payload;
      console.log(
        '[flycut-export][progress]',
        `stage=${payload.stage ?? '?'}`,
        `progress=${payload.progress ?? 0}`,
        payload.message ?? '',
      );
      this.reportProgress(
        this.mapStage(payload.stage),
        payload.progress ?? 0,
        payload.message ?? '处理中...',
      );
    });

    this.reportProgress('analyzing', 0, 'FFmpeg 引擎就绪');
  }

  async processVideo(segments: VideoSegment[], options: VideoProcessingOptions): Promise<Blob> {
    if (!this.videoFile?.path) {
      throw new Error('视频文件未初始化');
    }

    const outputFormat = options.format ?? options.outputFormat ?? 'mp4';
    const subtitleProcessing = options.subtitleProcessing ?? 'none';
    const keptCount = segments.filter((s) => s.keep).length;
    const deletedCount = segments.filter((s) => !s.keep).length;
    console.log('[flycut-export][start]', {
      inputPath: this.videoFile.path,
      outputFormat,
      quality: options.quality,
      subtitleProcessing,
      segments: segments.length,
      kept: keptCount,
      deleted: deletedCount,
      outputPath: options.outputPath ?? null,
      hasAssStyle: Boolean(options.subtitleStylePair || options.subtitleStyle),
    });

    let assContent: string | undefined;
    let subtitleTextContent: string | undefined;
    if (subtitleProcessing !== 'none' && (options.subtitleStylePair || options.subtitleStyle)) {
      const chunks: SubtitleChunk[] = (options.subtitleChunks ?? segments
        .filter((seg) => seg.keep && seg.text)
        .map((seg) => ({
          id: seg.id ?? `${seg.start}-${seg.end}`,
          text: seg.text!,
          secondText: seg.secondText,
          timestamp: [seg.start, seg.end] as [number, number],
          deleted: false,
        })));

      if (chunks.length > 0) {
        const stylePair = options.subtitleStylePair
          ?? { primary: options.subtitleStyle!, secondary: options.subtitleStyle! };
        const exportMode = options.subtitleExportMode ?? 'Bilingual';
        assContent = buildBurnAssContent({
          chunks,
          keptSegments: segments,
          stylePair,
          exportMode,
          softSubtitle: subtitleProcessing === 'soft',
          playResX: options.videoWidth ?? this.videoWidth,
          playResY: options.videoHeight ?? this.videoHeight,
        });
        if (subtitleProcessing === 'soft') {
          subtitleTextContent = buildBurnTextSubtitleContent({
            chunks,
            keptSegments: segments,
            exportMode,
          });
        }
        console.log('[flycut-export][subtitle]', {
          chunks: chunks.length,
          assBytes: assContent?.length ?? 0,
          softTextBytes: subtitleTextContent?.length ?? 0,
          exportMode,
        });
      }
    }

    const needsCutting = segments.some((seg) => !seg.keep);
    this.reportProgress(
      needsCutting ? 'cutting' : 'analyzing',
      5,
      needsCutting ? '调用 FFmpeg 裁剪...' : '调用 FFmpeg 处理...',
    );

    try {
      const result = await invoke<ProcessVideoResult>('process_video_with_ffmpeg', {
        options: {
          inputPath: this.videoFile.path,
          segments: segments.map((seg) => ({
            start: seg.start,
            end: seg.end,
            keep: seg.keep,
          })),
          outputFormat,
          quality: options.quality,
          preserveAudio: options.preserveAudio,
          subtitleProcessing,
          assContent: assContent ?? null,
          subtitleTextContent: subtitleTextContent ?? null,
          outputPath: options.outputPath ?? null,
        },
      });
      console.log('[flycut-export][done]', result);

      if (options.outputPath) {
        this.reportProgress('complete', 100, '导出完成');
        return new Blob([], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
      }

      const assetUrl = convertFileSrc(result.outputPath);
      const response = await fetch(assetUrl);
      if (!response.ok) {
        throw new Error(`读取输出视频失败: ${response.status}`);
      }

      const blob = await response.blob();
      console.log('[flycut-export][blob]', { size: blob.size, type: blob.type });
      this.reportProgress('complete', 100, '导出完成');
      return blob;
    } catch (error) {
      console.error('[flycut-export][error]', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.unlisten) {
      await this.unlisten();
      this.unlisten = null;
    }
    this.videoFile = null;
    this.onProgress = undefined;
  }

  configure(config: Record<string, unknown>): void {
    if (typeof config.videoWidth === 'number') this.videoWidth = config.videoWidth;
    if (typeof config.videoHeight === 'number') this.videoHeight = config.videoHeight;
  }

  private mapStage(stage?: string): VideoProcessingProgress['stage'] {
    switch (stage) {
      case 'cutting':
        return 'cutting';
      case 'encoding':
        return 'encoding';
      case 'complete':
        return 'complete';
      case 'error':
        return 'error';
      default:
        return 'analyzing';
    }
  }

  private reportProgress(
    stage: VideoProcessingProgress['stage'],
    progress: number,
    message: string,
  ) {
    this.onProgress?.({
      stage,
      progress: Math.min(100, Math.max(0, progress)),
      message,
    });
  }
}
