/** 字词时间戳组句：可配置断句条件 */
export interface SentenceGroupingOptions {
  /** 单句最大时长（秒），超长时强制断句 */
  maxDurationSec: number;
  /** 到下一 token 的停顿时长（秒），超过则断句 */
  pauseThresholdSec: number;
  /** token 文本以此结尾时断句（含逗号、空格等） */
  sentenceEnders: string[];
  /** 是否合并相邻纯数字 token（如 9 + 0 → 90） */
  mergeAdjacentDigitTokens: boolean;
}

export const DEFAULT_SENTENCE_GROUPING_OPTIONS: SentenceGroupingOptions = {
  maxDurationSec: 10,
  pauseThresholdSec: 0.6,
  sentenceEnders: ['.', '!', '?', '。', '！', '？', '…', '；', ';', ',', '，', ' '],
  mergeAdjacentDigitTokens: true,
};

export function resolveSentenceGroupingOptions(
  overrides?: Partial<SentenceGroupingOptions>,
): SentenceGroupingOptions {
  return {
    ...DEFAULT_SENTENCE_GROUPING_OPTIONS,
    ...overrides,
    sentenceEnders: overrides?.sentenceEnders ?? DEFAULT_SENTENCE_GROUPING_OPTIONS.sentenceEnders,
  };
}

export function endsSentence(text: string, sentenceEnders: string[]): boolean {
  const trimmed = text.trimEnd();
  return sentenceEnders.some((ender) => {
    if (ender === ' ') {
      return text.endsWith(' ') || trimmed !== text;
    }
    return trimmed.endsWith(ender);
  });
}