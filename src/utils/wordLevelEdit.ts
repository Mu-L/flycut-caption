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

/** 视频裁剪粒度：有字词时间戳时优先字词级，否则句子级 */
export function resolveCuttingChunks(
  chunks: SubtitleChunk[],
  wordChunks: SubtitleChunk[] | undefined,
  hasWordTimestamps: boolean,
): SubtitleChunk[] {
  if (canDeleteByWordAtRuntime({ hasWordTimestamps, wordChunks }) && wordChunks?.length) {
    return wordChunks;
  }
  return chunks;
}