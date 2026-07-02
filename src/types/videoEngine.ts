// 视频处理引擎类型定义

import type { VideoFile, VideoSegment, VideoProcessingProgress } from './video';
import type { SubtitleStyle } from '@/components/SubtitleSettings';

// 支持的视频处理引擎类型
export type VideoEngineType = 'webav' | 'ffmpeg' | 'ffmpeg-tauri' | 'webcodecs';

// 字幕处理类型
export type SubtitleProcessingType = 'none' | 'soft' | 'hard';

// 视频处理选项
export interface VideoProcessingOptions {
  format?: 'mp4' | 'webm' | 'avi';
  outputFormat?: 'mp4' | 'webm' | 'avi';
  quality: 'high' | 'medium' | 'low';
  preserveAudio: boolean;
  subtitleProcessing?: SubtitleProcessingType; // 字幕处理类型：无字幕、软烧录、硬烧录
  subtitleStyle?: SubtitleStyle; // 字幕样式配置
  engine?: VideoEngineType; // 指定使用的引擎
  videoWidth?: number;
  videoHeight?: number;
}

// 引擎能力检测结果
export interface EngineCapabilities {
  supported: boolean;
  reason?: string;
  formats: string[];
  maxFileSize?: number;
  features: {
    trimming: boolean;
    concatenation: boolean;
    audioProcessing: boolean;
    subtitleBurning: boolean;
    qualityControl: boolean;
  };
}

// 统一的视频处理引擎接口
export interface IVideoProcessingEngine {
  // 引擎信息
  readonly name: string;
  readonly type: VideoEngineType;
  readonly version?: string;

  // 引擎能力检测
  checkCapabilities(): Promise<EngineCapabilities>;
  
  // 初始化引擎
  initialize(videoFile: VideoFile, onProgress?: (progress: VideoProcessingProgress) => void): Promise<void>;
  
  // 处理视频
  processVideo(segments: VideoSegment[], options: VideoProcessingOptions): Promise<Blob>;
  
  // 清理资源
  cleanup(): Promise<void>;
  
  // 引擎特定的配置
  configure?(config: Record<string, unknown>): void;
}