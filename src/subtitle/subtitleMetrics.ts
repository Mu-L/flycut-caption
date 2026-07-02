import type { SubtitleStyle } from './subtitleStyle';
import { getStyleFontFamily } from './subtitleStyle';

/** 视频坐标系中的字号（px） */
export function resolveVideoFontSize(style: SubtitleStyle, videoHeight: number): number {
  if (!videoHeight || videoHeight <= 0) {
    return Math.round(1080 * style.fontSizeRatio);
  }
  return Math.max(8, Math.round(videoHeight * style.fontSizeRatio));
}

/** 视频坐标系中的底边距（px） */
export function resolveBottomOffset(style: SubtitleStyle, videoHeight: number): number {
  if (!videoHeight || videoHeight <= 0) {
    return Math.round(1080 * style.bottomOffsetRatio);
  }
  return Math.max(0, Math.round(videoHeight * style.bottomOffsetRatio));
}

/** 预览容器缩放：视频空间 px → 屏幕显示 px */
export function scaleVideoMetric(videoPixels: number, displayHeight: number, videoHeight: number): number {
  if (!videoHeight || videoHeight <= 0) return videoPixels;
  return Math.round(videoPixels * (displayHeight / videoHeight));
}

/** Canvas ctx.font 字符串 */
export function buildCanvasFont(style: SubtitleStyle, fontSizePx: number): string {
  return `${style.fontStyle} ${style.fontWeight} ${fontSizePx}px ${getStyleFontFamily(style)}`;
}

/** WebAV EmbedSubtitlesClip 使用的样式字段 */
export function resolveExportSubtitleMetrics(
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number,
) {
  const fontSize = resolveVideoFontSize(style, videoHeight);
  const bottomOffset = resolveBottomOffset(style, videoHeight);
  const borderWidth = Math.max(1, Math.round(style.borderWidth * (videoHeight / 1080)));
  const letterSpacing = Math.round(style.letterSpacing * (videoHeight / 1080));

  const scale = videoHeight / 1080;

  return {
    fontSize,
    bottomOffset,
    fontFamily: getStyleFontFamily(style),
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    borderWidth,
    letterSpacing: letterSpacing.toString(),
    shadowOffsetX: Math.round(style.shadowOffsetX * scale),
    shadowOffsetY: Math.round(style.shadowOffsetY * scale),
    shadowBlur: Math.round(style.shadowBlur * scale),
    videoWidth,
    videoHeight,
  };
}