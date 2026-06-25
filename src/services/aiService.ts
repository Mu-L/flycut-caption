// AI 服务（字幕纠错 / 翻译）单例
import type { AIModelConfig, AIProgress, AISubtitleItem } from '@/types/ai'
import { OpenAICompatibleEngine } from './aiEngines/OpenAICompatibleEngine'

export class AIService {
  private engine = new OpenAICompatibleEngine()

  setProgressCallback(callback: (progress: AIProgress) => void) {
    this.engine.setProgressCallback(callback)
  }

  async correct(
    items: AISubtitleItem[],
    model: AIModelConfig,
  ): Promise<AISubtitleItem[]> {
    return this.engine.correct(items, model)
  }

  async translate(
    items: AISubtitleItem[],
    model: AIModelConfig,
    targetLang: string,
  ): Promise<AISubtitleItem[]> {
    return this.engine.translate(items, model, targetLang)
  }
}

// 全局单例
export const aiService = new AIService()