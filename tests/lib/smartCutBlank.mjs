/**
 * 与 src/utils/smartCutBlank.ts + src/utils/timeUtils.ts 保持一致的纯函数镜像，供 node:test 使用。
 */

export function calculateBlankSegments(chunks, threshold, totalDuration) {
  if (chunks.length === 0) return [];
  if (threshold <= 0) return [];

  const active = chunks
    .filter((c) => !c.deleted)
    .slice()
    .sort((a, b) => a.timestamp[0] - b.timestamp[0]);

  if (active.length === 0) return [];

  const result = [];

  if (active[0].timestamp[0] >= threshold) {
    result.push({ start: 0, end: active[0].timestamp[0] });
  }

  for (let i = 1; i < active.length; i++) {
    const gapStart = active[i - 1].timestamp[1];
    const gapEnd = active[i].timestamp[0];
    if (gapEnd - gapStart >= threshold) {
      result.push({ start: gapStart, end: gapEnd });
    }
  }

  if (totalDuration !== undefined && Number.isFinite(totalDuration)) {
    const lastEnd = active[active.length - 1].timestamp[1];
    if (totalDuration - lastEnd >= threshold) {
      result.push({ start: lastEnd, end: totalDuration });
    }
  }

  return result;
}

export function computeSmartCutBlank(chunks, threshold, totalDuration) {
  const segments = calculateBlankSegments(chunks, threshold, totalDuration);
  const totalBlankSeconds = segments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
  return { segments, totalBlankSeconds };
}

export function applyBlankChunksPure(chunks, segments) {
  if (segments.length === 0) return chunks;

  const existingIds = new Set(chunks.map((chunk) => chunk.id));
  const newBlankChunks = [];

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