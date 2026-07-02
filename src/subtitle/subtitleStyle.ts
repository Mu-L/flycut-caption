// 字幕样式类型（唯一来源）

import {
  DEFAULT_SUBTITLE_FONT_ID,
  REFERENCE_VIDEO_HEIGHT,
  resolveFontFamily,
} from '@/config/subtitleFonts';
import type { AspectPreset } from './subtitlePresets';

/** 默认字号占视频高度比例（4.5%，1080p 约 49px） */
export const DEFAULT_FONT_SIZE_RATIO = 0.045;

/** 默认底边距占视频高度比例（1080p 约 60px） */
export const DEFAULT_BOTTOM_OFFSET_RATIO = 60 / REFERENCE_VIDEO_HEIGHT;

export interface SubtitleStyle {
  /** 字体 id，见 config/subtitleFonts */
  fontId: string;
  /** 字号占视频高度的比例（主存储） */
  fontSizeRatio: number;
  /** 底边距占视频高度的比例 */
  bottomOffsetRatio: number;
  /** 画面比例预设（影响安全区与最大行宽） */
  aspectPreset: AspectPreset;

  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';

  color: string;
  backgroundColor: string;
  borderColor: string;
  shadowColor: string;

  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;

  borderWidth: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;

  backgroundOpacity: number;
  backgroundRadius: number;
  backgroundPadding: number;

  visible: boolean;
}

export const defaultSubtitleStyle: SubtitleStyle = {
  fontId: DEFAULT_SUBTITLE_FONT_ID,
  fontSizeRatio: DEFAULT_FONT_SIZE_RATIO,
  bottomOffsetRatio: DEFAULT_BOTTOM_OFFSET_RATIO,
  aspectPreset: 'landscape',

  fontWeight: 'bold',
  fontStyle: 'normal',

  color: '#FFFFFF',
  backgroundColor: '#000000',
  borderColor: '#000000',
  shadowColor: '#000000',

  textAlign: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,

  borderWidth: 1,
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  shadowBlur: 2,

  backgroundOpacity: 0.8,
  backgroundRadius: 4,
  backgroundPadding: 8,

  visible: true,
};

/** UI 展示：1080p 等价像素字号 */
export function fontSizeAtReference(style: SubtitleStyle): number {
  return Math.round(REFERENCE_VIDEO_HEIGHT * style.fontSizeRatio);
}

/** UI 展示：1080p 等价底边距 */
export function bottomOffsetAtReference(style: SubtitleStyle): number {
  return Math.round(REFERENCE_VIDEO_HEIGHT * style.bottomOffsetRatio);
}

export function fontSizeRatioFromReference(pxAt1080: number): number {
  return pxAt1080 / REFERENCE_VIDEO_HEIGHT;
}

export function bottomOffsetRatioFromReference(pxAt1080: number): number {
  return pxAt1080 / REFERENCE_VIDEO_HEIGHT;
}

export function getStyleFontFamily(style: SubtitleStyle): string {
  return resolveFontFamily(style.fontId);
}

export type ShadowSize = 'N' | 'S' | 'M' | 'L';

const SHADOW_SIZE_PRESETS: Record<
  ShadowSize,
  Pick<SubtitleStyle, 'shadowBlur' | 'shadowOffsetX' | 'shadowOffsetY'>
> = {
  N: { shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 },
  S: { shadowBlur: 2, shadowOffsetX: 1, shadowOffsetY: 1 },
  M: { shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2 },
  L: { shadowBlur: 6, shadowOffsetX: 3, shadowOffsetY: 3 },
};

/** 将工作站 N/S/M/L 阴影档位映射到字幕样式 */
export function applyShadowSize(style: SubtitleStyle, size: ShadowSize): SubtitleStyle {
  return { ...style, ...SHADOW_SIZE_PRESETS[size] };
}

/** 从旧版绝对 px 样式迁移 */
export function migrateSubtitleStyle(
  legacy: Partial<SubtitleStyle> & {
    fontSize?: number;
    bottomOffset?: number;
    fontFamily?: string;
  },
): SubtitleStyle {
  const base = { ...defaultSubtitleStyle, ...legacy };

  if (legacy.fontSizeRatio == null && legacy.fontSize != null) {
    base.fontSizeRatio = legacy.fontSize / REFERENCE_VIDEO_HEIGHT;
  }

  if (legacy.bottomOffsetRatio == null && legacy.bottomOffset != null) {
    base.bottomOffsetRatio = legacy.bottomOffset / REFERENCE_VIDEO_HEIGHT;
  }

  if (legacy.aspectPreset == null) {
    base.aspectPreset = 'landscape';
  }

  if (legacy.fontId == null && legacy.fontFamily != null) {
    const family = legacy.fontFamily.toLowerCase();
    if (family.includes('noto') || family.includes('source han') || family.includes('yahei') || family.includes('pingfang')) {
      base.fontId = 'noto-sans-sc';
    } else if (family.includes('inter')) {
      base.fontId = 'inter';
    } else if (family.includes('georgia')) {
      base.fontId = 'georgia';
    } else if (family.includes('arial')) {
      base.fontId = 'arial';
    }
  }

  return base;
}