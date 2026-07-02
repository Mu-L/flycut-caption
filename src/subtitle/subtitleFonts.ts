// 注册并预加载字幕用开源字体（@fontsource 自托管 woff2）

import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';

import { getSubtitleFont } from '@/config/subtitleFonts';
import type { SubtitleStyle } from './subtitleStyle';
import { buildCanvasFont } from './subtitleMetrics';

let fontsRegistered = false;

/** 导入 CSS 后调用一次，确保 @font-face 已注册 */
export function registerSubtitleFonts(): void {
  fontsRegistered = true;
}

/**
 * 在 Canvas 绘制前加载字体，避免 fallback 或闪烁。
 * 系统字体（Arial / Georgia）跳过网络加载。
 */
export async function ensureSubtitleFont(
  style: SubtitleStyle,
  fontSizePx: number,
): Promise<void> {
  if (!fontsRegistered) {
    registerSubtitleFonts();
  }

  const def = getSubtitleFont(style.fontId);
  if (!def || def.id === 'arial' || def.id === 'georgia') {
    return;
  }

  const fontSpec = buildCanvasFont(style, fontSizePx);
  try {
    await document.fonts.load(fontSpec);
  } catch {
    // 字体加载失败时仍尝试绘制，由系统 fallback 兜底
  }
}