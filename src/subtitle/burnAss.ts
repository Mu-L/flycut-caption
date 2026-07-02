import type { SubtitleChunk } from '@/types/subtitle';
import type { VideoSegment } from '@/types/video';
import type { SubtitleStyle } from './subtitleStyle';
import { chunksToAss, type AssExportOptions } from './exportFormats';
import { mapSubtitleTimingsToCutVideo, applyMappedTimings } from './subtitleTimeMapping';
import { formatBilingualText } from './subtitleLayout';

export interface BuildBurnAssOptions {
  chunks: SubtitleChunk[];
  keptSegments: VideoSegment[];
  style: SubtitleStyle;
  playResX: number;
  playResY: number;
}

/** 为 FFmpeg 硬/软烧录生成时间轴已重映射的 ASS 内容 */
export function buildBurnAssContent(options: BuildBurnAssOptions): string {
  const { chunks, keptSegments, style, playResX, playResY } = options;

  const activeChunks = chunks.filter((c) => !c.deleted && c.text.trim());
  const mapping = mapSubtitleTimingsToCutVideo(keptSegments, activeChunks);
  const remapped = applyMappedTimings(activeChunks, mapping);

  const dialogueChunks: SubtitleChunk[] = remapped.map((chunk) => ({
    ...chunk,
    text: formatBilingualText(
      chunk.text,
      chunk.secondText,
      style,
      playResX,
      playResY,
    ),
    secondText: undefined,
  }));

  const assOptions: AssExportOptions = {
    playResX,
    playResY,
    style,
    title: 'FlyCut Caption Burn',
  };

  return chunksToAss(dialogueChunks, assOptions);
}