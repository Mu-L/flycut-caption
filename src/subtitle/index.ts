export {
  defaultSubtitleStyle,
  migrateSubtitleStyle,
  fontSizeAtReference,
  bottomOffsetAtReference,
  fontSizeRatioFromReference,
  bottomOffsetRatioFromReference,
  getStyleFontFamily,
  applyShadowSize,
  type ShadowSize,
  DEFAULT_FONT_SIZE_RATIO,
  DEFAULT_BOTTOM_OFFSET_RATIO,
} from './subtitleStyle';
export type { SubtitleStyle } from './subtitleStyle';

export {
  resolveVideoFontSize,
  resolveBottomOffset,
  scaleVideoMetric,
  buildCanvasFont,
  resolveExportSubtitleMetrics,
} from './subtitleMetrics';

export { registerSubtitleFonts, ensureSubtitleFont } from './subtitleFonts';

export {
  layoutSubtitleLines,
  resolveLayoutMaxWidth,
  formatBilingualText,
} from './subtitleLayout';

export { renderSubtitleFrame } from './subtitleRenderer';
export type { SubtitleRenderContent, SubtitleRenderFrame } from './subtitleRenderer';

export {
  ASPECT_PRESETS,
  STYLE_PRESETS,
  applyAspectPreset,
  applyStylePreset,
  matchActiveStylePreset,
  inferAspectPreset,
  getMaxWidthRatio,
} from './subtitlePresets';
export type { AspectPreset, StylePresetId } from './subtitlePresets';

export {
  chunksToSrt,
  chunksToVtt,
  chunksToJson,
  chunksToAss,
  serializeSubtitleExport,
  getExportFilename,
  getExportMimeType,
  getExportFileTypes,
} from './exportFormats';
export type { SubtitleExportFormat, AssExportOptions } from './exportFormats';

export { stripSubtitleDisplayPunctuation } from './cjkPunctuation';

export { buildBurnAssContent } from './burnAss';
export { mapSubtitleTimingsToCutVideo, applyMappedTimings } from './subtitleTimeMapping';

export { SUBTITLE_FONTS, REFERENCE_VIDEO_HEIGHT, DEFAULT_SUBTITLE_FONT_ID } from '@/config/subtitleFonts';
export type { SubtitleFontDefinition } from '@/config/subtitleFonts';