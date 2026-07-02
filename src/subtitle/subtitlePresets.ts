import type { SubtitleStyle } from './subtitleStyle';
import { DEFAULT_BOTTOM_OFFSET_RATIO } from './subtitleStyle';

export type AspectPreset = 'landscape' | 'portrait_9_16' | 'square_1_1';
export type StylePresetId = 'classic' | 'boxed' | 'minimal';

export interface AspectPresetConfig {
  id: AspectPreset;
  label: string;
  bottomOffsetRatio: number;
  maxWidthRatio: number;
}

export const ASPECT_PRESETS: AspectPresetConfig[] = [
  {
    id: 'landscape',
    label: '横屏 16:9',
    bottomOffsetRatio: DEFAULT_BOTTOM_OFFSET_RATIO,
    maxWidthRatio: 0.9,
  },
  {
    id: 'portrait_9_16',
    label: '竖屏 9:16',
    bottomOffsetRatio: 130 / 1080,
    maxWidthRatio: 0.85,
  },
  {
    id: 'square_1_1',
    label: '方形 1:1',
    bottomOffsetRatio: 80 / 1080,
    maxWidthRatio: 0.88,
  },
];

export const STYLE_PRESETS: Array<{
  id: StylePresetId;
  label: string;
  patch: Partial<SubtitleStyle>;
}> = [
  {
    id: 'classic',
    label: '经典白字黑边',
    patch: {
      color: '#FFFFFF',
      borderColor: '#000000',
      borderWidth: 2,
      backgroundOpacity: 0,
      shadowBlur: 2,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
      fontWeight: 'bold',
    },
  },
  {
    id: 'boxed',
    label: '黑底白字',
    patch: {
      color: '#FFFFFF',
      backgroundColor: '#000000',
      backgroundOpacity: 0.8,
      borderWidth: 0,
      shadowBlur: 0,
      fontWeight: 'bold',
    },
  },
  {
    id: 'minimal',
    label: '简约无描边',
    patch: {
      color: '#FFFFFF',
      borderWidth: 0,
      backgroundOpacity: 0,
      shadowBlur: 3,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
      shadowColor: '#000000',
      fontWeight: 'normal',
    },
  },
];

export function getAspectPresetConfig(preset: AspectPreset): AspectPresetConfig {
  return ASPECT_PRESETS.find((p) => p.id === preset) ?? ASPECT_PRESETS[0];
}

export function getMaxWidthRatio(preset: AspectPreset): number {
  return getAspectPresetConfig(preset).maxWidthRatio;
}

export function applyAspectPreset(
  style: SubtitleStyle,
  preset: AspectPreset,
): SubtitleStyle {
  const config = getAspectPresetConfig(preset);
  return {
    ...style,
    aspectPreset: preset,
    bottomOffsetRatio: config.bottomOffsetRatio,
  };
}

export function applyStylePreset(
  style: SubtitleStyle,
  presetId: StylePresetId,
): SubtitleStyle {
  const preset = STYLE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return style;
  return { ...style, ...preset.patch };
}

export function inferAspectPreset(videoWidth: number, videoHeight: number): AspectPreset {
  if (!videoWidth || !videoHeight) return 'landscape';
  const ratio = videoWidth / videoHeight;
  if (ratio < 0.85) return 'portrait_9_16';
  if (ratio > 1.15) return 'landscape';
  return 'square_1_1';
}