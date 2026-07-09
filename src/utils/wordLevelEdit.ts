import type { ModelTimestampDto } from '@/types/model';
import type { SubtitleChunk } from '@/types/subtitle';

/** manifest / Web 模型是否声明支持 token/word 级时间戳（用于按字词删除能力提示） */
export function modelClaimsWordTimestamps(
  timestamp?: ModelTimestampDto | null,
): boolean {
  if (!timestamp) return false;
  if (timestamp.token_timestamp_verified) return true;
  return timestamp.level === 'token' || timestamp.level === 'word';
}

/** 当前转写结果是否已具备按字词删除能力（以 ASR 实际输出为准） */
export function canDeleteByWordAtRuntime(params: {
  hasWordTimestamps: boolean;
  wordChunks?: SubtitleChunk[] | null;
}): boolean {
  return params.hasWordTimestamps === true && (params.wordChunks?.length ?? 0) > 0;
}

/**
 * 是否应向用户提示「该模型支持按字词删除」（manifest token_timestamp_verified 或 level=token/word）。
 * ASR 完成前用于 UI 说明；真正可删仍以 canDeleteByWordAtRuntime 为准。
 */
export function shouldAdvertiseWordLevelDelete(
  modelTimestamp?: ModelTimestampDto | null,
): boolean {
  return modelClaimsWordTimestamps(modelTimestamp);
}

/** 视频裁剪粒度：有字词时间戳时优先字词级，并合并空白占位段 */
export function resolveCuttingChunks(
  chunks: SubtitleChunk[],
  wordChunks: SubtitleChunk[] | undefined,
  hasWordTimestamps: boolean,
): SubtitleChunk[] {
  if (canDeleteByWordAtRuntime({ hasWordTimestamps, wordChunks }) && wordChunks?.length) {
    // 句子级删除时，所属字词即使未单独标记 deleted 也视为删除（防御历史数据不同步）
    const deletedSentenceIds = new Set(
      chunks
        .filter((chunk) => !chunk.isBlankSpacer && chunk.deleted)
        .map((chunk) => chunk.id),
    );
    const effectiveWords = wordChunks.map((word) => {
      if (word.deleted) return word;
      if (word.sentenceId && deletedSentenceIds.has(word.sentenceId)) {
        return { ...word, deleted: true };
      }
      return word;
    });
    const blankSpacers = chunks.filter((chunk) => chunk.isBlankSpacer);
    return [...effectiveWords, ...blankSpacers].sort((a, b) => a.timestamp[0] - b.timestamp[0]);
  }
  return chunks;
}