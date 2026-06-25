// OpenAI 兼容引擎：通过 /chat/completions 对接字幕纠错 / 翻译
import type { AIModelConfig, AIProgress, AISubtitleItem } from '@/types/ai'

// 单次分片处理的最大条数
const CHUNK_SIZE = 50

export interface OpenAICompatibleEngineConfig {
  temperature?: number
}

export class OpenAICompatibleEngine {
  private progressCallback: ((p: AIProgress) => void) | null = null

  setProgressCallback(cb: (p: AIProgress) => void) {
    this.progressCallback = cb
  }

  private report(p: AIProgress) {
    this.progressCallback?.(p)
  }

  /**
   * 字幕纠错：修正 ASR 错别字/标点/口语化，保持行数与顺序
   */
  async correct(
    items: AISubtitleItem[],
    model: AIModelConfig,
  ): Promise<AISubtitleItem[]> {
    const system =
      '你是字幕纠错专家。请修正输入字幕中的语音识别错别字、标点缺失、口语化冗词，使语句通顺自然。' +
      '严格保持输入顺序与条数，只输出 JSON 数组，元素为 {"id": <原id>, "text": <修正后文本>}，不含额外解释。'
    return this.runItems(items, model, system, '纠错')
  }

  /**
   * 字幕翻译：将每条翻译为指定语言
   */
  async translate(
    items: AISubtitleItem[],
    model: AIModelConfig,
    targetLang: string,
  ): Promise<AISubtitleItem[]> {
    const system =
      `你是专业字幕翻译。请将每条字幕翻译为「${targetLang}」，保持简洁口语化，符合字幕阅读习惯。` +
      '严格保持输入顺序与条数，只输出 JSON 数组，元素为 {"id": <原id>, "text": <译文>}，不含额外解释。'
    return this.runItems(items, model, system, `翻译为 ${targetLang}`)
  }

  private async runItems(
    items: AISubtitleItem[],
    model: AIModelConfig,
    system: string,
    stageLabel: string,
  ): Promise<AISubtitleItem[]> {
    if (items.length === 0) return []
    const total = items.length
    const results: AISubtitleItem[] = []

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const slice = items.slice(i, i + CHUNK_SIZE)
      this.report({
        status: 'running',
        progress: Math.round((i / total) * 100),
        data: `${stageLabel} ${i + 1}-${Math.min(i + CHUNK_SIZE, total)}/${total}`,
      })

      const parsed = await this.requestSlice(slice, model, system)
      // 按 id 对齐回原 slice
      const map = new Map(parsed.map((p) => [p.id, p.text]))
      for (const item of slice) {
        const text = map.get(item.id)
        results.push({ id: item.id, text: typeof text === 'string' ? text : item.text })
      }

      this.report({
        status: 'running',
        progress: Math.round((Math.min(i + CHUNK_SIZE, total) / total) * 100),
        data: `${stageLabel} ${Math.min(i + CHUNK_SIZE, total)}/${total} 完成`,
      })
    }

    this.report({ status: 'complete', progress: 100, data: `${stageLabel}完成` })
    return results
  }

  private async requestSlice(
    slice: AISubtitleItem[],
    model: AIModelConfig,
    system: string,
  ): Promise<{ id: string; text: string }[]> {
    const userContent = JSON.stringify(
      slice.map((s) => ({ id: s.id, text: s.text })),
    )

    const baseUrl = model.baseUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/chat/completions`

    const body: Record<string, unknown> = {
      model: model.model,
      temperature: model.temperature ?? 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`AI 请求失败 (${resp.status}): ${errText.slice(0, 200)}`)
    }

    const data = await resp.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const parsed = this.parseContent(content)
    if (!Array.isArray(parsed)) {
      throw new Error('AI 返回内容无法解析为 JSON 数组')
    }

    // 校验条数一致
    if (parsed.length !== slice.length) {
      throw new Error(
        `AI 返回条数不一致：期望 ${slice.length}，实际 ${parsed.length}`,
      )
    }
    return parsed as { id: string; text: string }[]
  }

  /**
   * 解析模型输出。兼容 json_object 包裹和直接数组两种形态。
   */
  private parseContent(content: string): unknown {
    if (!content) return null
    const trimmed = content.trim()

    // 直接是 JSON 数组
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        // fallthrough
      }
    }

    // 可能是 {"items": [...]} 或 {"results": [...]}
    try {
      const obj = JSON.parse(trimmed)
      if (Array.isArray(obj)) return obj
      if (obj && typeof obj === 'object') {
        const arrVal = Object.values(obj).find((v) => Array.isArray(v))
        if (arrVal) return arrVal
      }
    } catch {
      // fallthrough
    }

    // 兜底：从文本中提取首个 JSON 数组片段
    const match = trimmed.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
}