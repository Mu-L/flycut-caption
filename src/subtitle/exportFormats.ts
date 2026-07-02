import type { SubtitleChunk } from '@/types/subtitle';
import type { SubtitleStyle } from './subtitleStyle';
import { defaultSubtitleStyle, getStyleFontFamily } from './subtitleStyle';
import { REFERENCE_VIDEO_HEIGHT } from '@/config/subtitleFonts';

export type SubtitleExportFormat = 'srt' | 'json' | 'vtt' | 'ass';

function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVttTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatAssTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds % 1) * 100);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

function chunkBody(chunk: SubtitleChunk): string {
  if (chunk.secondText?.trim()) {
    return `${chunk.text}\n${chunk.secondText}`;
  }
  return chunk.text;
}

/** #RRGGBB → ASS &HAABBGGRR */
function hexToAssColor(hex: string): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return '&H00FFFFFF';
  const r = normalized.slice(0, 2);
  const g = normalized.slice(2, 4);
  const b = normalized.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

export function chunksToSrt(chunks: SubtitleChunk[]): string {
  return chunks
    .filter((c) => !c.deleted)
    .map((chunk, index) => {
      const start = formatSrtTime(chunk.timestamp[0]);
      const end = formatSrtTime(chunk.timestamp[1]);
      return `${index + 1}\n${start} --> ${end}\n${chunkBody(chunk)}\n`;
    })
    .join('\n');
}

export function chunksToVtt(chunks: SubtitleChunk[]): string {
  const lines = ['WEBVTT', ''];
  chunks
    .filter((c) => !c.deleted)
    .forEach((chunk, index) => {
      lines.push(String(index + 1));
      lines.push(`${formatVttTime(chunk.timestamp[0])} --> ${formatVttTime(chunk.timestamp[1])}`);
      lines.push(chunkBody(chunk));
      lines.push('');
    });
  return lines.join('\n');
}

export function chunksToJson(chunks: SubtitleChunk[]): string {
  const kept = chunks
    .filter((c) => !c.deleted)
    .map((chunk) => ({
      text: chunk.text,
      secondText: chunk.secondText,
      timestamp: chunk.timestamp,
    }));
  return JSON.stringify(kept, null, 2);
}

export interface AssExportOptions {
  playResX: number;
  playResY: number;
  style: SubtitleStyle;
  title?: string;
}

export function chunksToAss(chunks: SubtitleChunk[], options: AssExportOptions): string {
  const { playResX, playResY, style, title = 'FlyCut Caption' } = options;
  const fontName = getStyleFontFamily(style).replace(/"/g, '');
  const fontSize = Math.round(playResY * style.fontSizeRatio);
  const marginV = Math.round(playResY * style.bottomOffsetRatio);
  const primaryColour = hexToAssColor(style.color);
  const outlineColour = hexToAssColor(style.borderColor);
  const backColour = hexToAssColor(style.backgroundColor);
  const bold = style.fontWeight === 'bold' ? -1 : 0;
  const italic = style.fontStyle === 'italic' ? -1 : 0;
  const outline = style.borderWidth;
  const shadow = style.shadowBlur > 0 ? 1 : 0;

  const header = [
    '[Script Info]',
    `Title: ${title}`,
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primaryColour},&H000000FF,${outlineColour},${backColour},${bold},${italic},0,0,100,100,0,0,1,${outline},${shadow},2,20,20,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = chunks
    .filter((c) => !c.deleted)
    .map((chunk) => {
      const start = formatAssTime(chunk.timestamp[0]);
      const end = formatAssTime(chunk.timestamp[1]);
      const text = chunkBody(chunk).replace(/\n/g, '\\N');
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    });

  return [...header, ...events].join('\n');
}

export function getExportFilename(format: SubtitleExportFormat): string {
  return `subtitles_${Date.now()}.${format}`;
}

export function getExportMimeType(format: SubtitleExportFormat): string {
  switch (format) {
    case 'json':
      return 'application/json';
    case 'vtt':
      return 'text/vtt';
    case 'ass':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

export interface SerializeExportOptions {
  ass?: AssExportOptions;
}

export function serializeSubtitleExport(
  format: SubtitleExportFormat,
  chunks: SubtitleChunk[],
  options?: SerializeExportOptions,
): string {
  switch (format) {
    case 'srt':
      return chunksToSrt(chunks);
    case 'vtt':
      return chunksToVtt(chunks);
    case 'json':
      return chunksToJson(chunks);
    case 'ass':
      return chunksToAss(chunks, options?.ass ?? {
        playResX: 1920,
        playResY: REFERENCE_VIDEO_HEIGHT,
        style: defaultSubtitleStyle,
      });
    default:
      return chunksToSrt(chunks);
  }
}

export function getExportFileTypes(format: SubtitleExportFormat): Array<{
  description: string;
  accept: Record<string, string[]>;
}> {
  const map: Record<SubtitleExportFormat, Record<string, string[]>> = {
    srt: { 'text/srt': ['.srt'] },
    json: { 'application/json': ['.json'] },
    vtt: { 'text/vtt': ['.vtt'] },
    ass: { 'text/plain': ['.ass'] },
  };
  const labels: Record<SubtitleExportFormat, string> = {
    srt: 'SRT Subtitle files',
    json: 'JSON files',
    vtt: 'WebVTT files',
    ass: 'ASS/SSA subtitle files',
  };
  return [{ description: labels[format], accept: map[format] }];
}