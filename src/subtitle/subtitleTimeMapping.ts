import type { SubtitleChunk } from '@/types/subtitle';
import type { VideoSegment } from '@/types/video';

export interface MappedSubtitleTiming {
  start: number;
  end: number;
}

/** 将原始时间轴字幕映射到裁剪后视频的连续时间轴（秒） */
export function mapSubtitleTimingsToCutVideo(
  keptSegments: VideoSegment[],
  subtitleChunks: SubtitleChunk[],
): Map<SubtitleChunk, MappedSubtitleTiming> {
  const mapping = new Map<SubtitleChunk, MappedSubtitleTiming>();
  const sortedKept = [...keptSegments]
    .filter((seg) => seg.keep)
    .sort((a, b) => a.start - b.start);

  let currentOffset = 0;

  for (const segment of sortedKept) {
    const segmentSubtitles = subtitleChunks.filter((subtitle) => {
      const [subtitleStart, subtitleEnd] = subtitle.timestamp;
      return subtitleStart < segment.end && subtitleEnd > segment.start;
    });

    for (const subtitle of segmentSubtitles) {
      const [subtitleStart, subtitleEnd] = subtitle.timestamp;
      const overlapStart = Math.max(subtitleStart, segment.start);
      const overlapEnd = Math.min(subtitleEnd, segment.end);

      if (overlapStart >= overlapEnd) continue;

      const relativeStart = overlapStart - segment.start;
      const finalStart = currentOffset + relativeStart;
      const finalEnd = currentOffset + (overlapEnd - segment.start);

      const existing = mapping.get(subtitle);
      if (existing) {
        mapping.set(subtitle, {
          start: Math.min(existing.start, finalStart),
          end: Math.max(existing.end, finalEnd),
        });
      } else {
        mapping.set(subtitle, { start: finalStart, end: finalEnd });
      }
    }

    currentOffset += segment.end - segment.start;
  }

  return mapping;
}

export function applyMappedTimings(
  chunks: SubtitleChunk[],
  mapping: Map<SubtitleChunk, MappedSubtitleTiming>,
): SubtitleChunk[] {
  const result: SubtitleChunk[] = [];

  for (const chunk of chunks) {
    const mapped = mapping.get(chunk);
    if (!mapped || mapped.end <= mapped.start) continue;
    result.push({
      ...chunk,
      timestamp: [mapped.start, mapped.end],
    });
  }

  return result.sort((a, b) => a.timestamp[0] - b.timestamp[0]);
}