import { calculateBlankSegments } from '@/utils/timeUtils';
import type { SubtitleChunk } from '@/types/subtitle';

export interface SmartCutBlankResult {
  segments: Array<{ start: number; end: number }>;
  totalBlankSeconds: number;
}

/** 计算可剪切的空白段（纯函数，便于单测） */
export function computeSmartCutBlank(
  chunks: Array<{ timestamp: [number, number]; deleted?: boolean }>,
  threshold: number,
  totalDuration?: number,
): SmartCutBlankResult {
  const segments = calculateBlankSegments(chunks, threshold, totalDuration);
  const totalBlankSeconds = segments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
  return { segments, totalBlankSeconds };
}

/**
 * 将空白段插入为已删除的占位 chunk（与 historyStore.insertBlankChunks 逻辑一致，纯函数版本供测试）
 */
export function applyBlankChunksPure(
  chunks: SubtitleChunk[],
  segments: Array<{ start: number; end: number }>,
): SubtitleChunk[] {
  if (segments.length === 0) return chunks;

  const existingIds = new Set(chunks.map((chunk) => chunk.id));
  const newBlankChunks: SubtitleChunk[] = [];

  for (const seg of segments) {
    const id = `blank-${seg.start.toFixed(3)}-${seg.end.toFixed(3)}`;
    if (existingIds.has(id)) continue;
    newBlankChunks.push({
      id,
      text: '',
      timestamp: [seg.start, seg.end],
      deleted: true,
      isBlankSpacer: true,
    });
  }

  if (newBlankChunks.length === 0) return chunks;

  return [...chunks, ...newBlankChunks].sort((a, b) => a.timestamp[0] - b.timestamp[0]);
}

export interface RunSmartCutBlankOptions {
  chunks: Array<{ timestamp: [number, number]; deleted?: boolean }>;
  threshold: number;
  totalDuration?: number;
  onEmpty: () => void;
  onDone: (result: SmartCutBlankResult) => void;
  insertBlankChunks: (segments: Array<{ start: number; end: number }>) => void;
}

/** UI 层共用的智能剪空白编排 */
export function runSmartCutBlank({
  chunks,
  threshold,
  totalDuration,
  onEmpty,
  onDone,
  insertBlankChunks,
}: RunSmartCutBlankOptions): void {
  const result = computeSmartCutBlank(chunks, threshold, totalDuration);
  if (result.segments.length === 0) {
    onEmpty();
    return;
  }
  insertBlankChunks(result.segments);
  onDone(result);
}