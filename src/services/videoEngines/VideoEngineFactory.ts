// 视频处理引擎工厂

import type { IVideoProcessingEngine, VideoEngineType, EngineCapabilities } from '@/types/videoEngine';
import { WebAVEngine } from './WebAVEngine';
import { FFmpegEngine } from './FFmpegEngine';
import { FFmpegTauriEngine } from './FFmpegTauriEngine';
import { isTauriRuntime } from '@/utils/runtime';
// import { WebCodecsEngine } from './WebCodecsEngine'; // 未来扩展

export class VideoEngineFactory {
  private static engines = new Map<VideoEngineType, new () => IVideoProcessingEngine>([
    ['webav', WebAVEngine],
    ['ffmpeg', FFmpegEngine],
    ['ffmpeg-tauri', FFmpegTauriEngine],
    // ['webcodecs', WebCodecsEngine], // 未来扩展
  ]);

  /**
   * 获取指定类型的引擎实例
   */
  static async createEngine(type: VideoEngineType): Promise<IVideoProcessingEngine> {
    const EngineClass = this.engines.get(type);
    if (!EngineClass) {
      throw new Error(`不支持的视频处理引擎类型: ${type}`);
    }

    const engine = new EngineClass();
    
    // 检查引擎是否可用
    const capabilities = await engine.checkCapabilities();
    if (!capabilities.supported) {
      throw new Error(`引擎 ${type} 不可用: ${capabilities.reason}`);
    }

    return engine;
  }

  /**
   * 获取最佳可用引擎
   * 根据用户环境自动选择最适合的引擎
   */
  static getDefaultEngineOrder(): VideoEngineType[] {
    return isTauriRuntime()
      ? ['ffmpeg-tauri', 'webav', 'ffmpeg']
      : ['webav', 'ffmpeg'];
  }

  static async getBestAvailableEngine(preferredOrder?: VideoEngineType[]): Promise<{
    engine: IVideoProcessingEngine;
    type: VideoEngineType;
  }> {
    const order = preferredOrder ?? VideoEngineFactory.getDefaultEngineOrder();
    for (const type of order) {
      try {
        const engine = await this.createEngine(type);
        console.log(`选择视频处理引擎: ${type}`);
        return { engine, type };
      } catch (error) {
        console.warn(`引擎 ${type} 不可用:`, error);
        continue;
      }
    }
    
    throw new Error('没有可用的视频处理引擎');
  }

  /**
   * 检查所有引擎的可用性
   */
  static async checkAllEngines(): Promise<Record<VideoEngineType, EngineCapabilities>> {
    const results = {} as Record<VideoEngineType, EngineCapabilities>;
    
    for (const [type] of this.engines) {
      try {
        const EngineClass = this.engines.get(type)!;
        const engine = new EngineClass();
        results[type] = await engine.checkCapabilities();
      } catch (error) {
        results[type] = {
          supported: false,
          reason: error instanceof Error ? error.message : '未知错误',
          formats: [],
          features: {
            trimming: false,
            concatenation: false,
            audioProcessing: false,
            subtitleBurning: false,
            qualityControl: false,
          }
        };
      }
    }
    
    return results;
  }

  /**
   * 注册新的引擎类型（用于插件化扩展）
   */
  static registerEngine(type: VideoEngineType, engineClass: new () => IVideoProcessingEngine) {
    this.engines.set(type, engineClass);
    console.log(`注册视频处理引擎: ${type}`);
  }

  /**
   * 获取所有支持的引擎类型
   */
  static getSupportedEngines(): VideoEngineType[] {
    return Array.from(this.engines.keys());
  }
}