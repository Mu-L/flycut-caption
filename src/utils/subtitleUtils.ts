// 字幕渲染工具函数（WebAV 遗留辅助；主渲染见 src/subtitle/）

import { renderTxt2ImgBitmap, ImgClip } from '@webav/av-cliper';

interface LegacyWebAVSubtitleStyle {
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  padding?: number;
  borderRadius?: number;
  textShadow?: string;
  textAlign?: 'left' | 'center' | 'right';
  maxWidth?: number;
}

const DEFAULT_LEGACY_STYLE: Required<LegacyWebAVSubtitleStyle> = {
  fontSize: 32,
  color: 'white',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  fontFamily: '"Noto Sans SC", Arial, sans-serif',
  padding: 12,
  borderRadius: 6,
  textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
  textAlign: 'center',
  maxWidth: 800,
};

function styleToCSS(style: LegacyWebAVSubtitleStyle): string {
  const mergedStyle = { ...DEFAULT_LEGACY_STYLE, ...style };

  return `
    font-size: ${mergedStyle.fontSize}px;
    color: ${mergedStyle.color};
    background: ${mergedStyle.backgroundColor};
    font-family: ${mergedStyle.fontFamily};
    padding: ${mergedStyle.padding}px;
    border-radius: ${mergedStyle.borderRadius}px;
    text-shadow: ${mergedStyle.textShadow};
    text-align: ${mergedStyle.textAlign};
    max-width: ${mergedStyle.maxWidth}px;
    word-wrap: break-word;
    white-space: pre-wrap;
    box-sizing: border-box;
    display: inline-block;
  `.trim();
}

/** @deprecated 请使用 src/subtitle/subtitleRenderer */
export async function createSubtitleImage(
  text: string,
  style?: LegacyWebAVSubtitleStyle,
): Promise<ImageBitmap> {
  const cssStyle = styleToCSS(style || {});
  return await renderTxt2ImgBitmap(text, cssStyle);
}

/** @deprecated 请使用 src/subtitle/subtitleRenderer */
export async function createSubtitleClip(
  text: string,
  style?: LegacyWebAVSubtitleStyle,
): Promise<ImgClip> {
  const bitmap = await createSubtitleImage(text, style);
  return new ImgClip(bitmap);
}

export function formatSubtitleText(text: string, maxLength: number = 30): string {
  if (text.length <= maxLength) {
    return text;
  }

  const words = text.split(/(\s|[，。！？；：、])/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length <= maxLength) {
      currentLine += word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        lines.push(word);
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

export function calculateSubtitlePosition(
  videoWidth: number,
  videoHeight: number,
  subtitleWidth: number,
  subtitleHeight: number,
): { x: number; y: number } {
  const margin = Math.min(videoHeight * 0.1, 60);

  return {
    x: (videoWidth - subtitleWidth) / 2,
    y: videoHeight - subtitleHeight - margin,
  };
}

export function secondsToMicroseconds(seconds: number): number {
  return Math.floor(seconds * 1e6);
}

export function microsecondsToSeconds(microseconds: number): number {
  return microseconds / 1e6;
}