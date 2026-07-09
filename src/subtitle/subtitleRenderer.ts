import type { SubtitleStyle } from './subtitleStyle';
import {
  resolveVideoFontSize,
  resolveBottomOffset,
  scaleVideoMetric,
  buildCanvasFont,
} from './subtitleMetrics';
import { ensureSubtitleFont } from './subtitleFonts';
import { layoutSubtitleLines, resolveLayoutMaxWidth } from './subtitleLayout';

const BLOCK_GAP_RATIO = 0.15;

export type SubtitleDisplayMode = 'Bilingual' | 'Main' | 'Second';

export interface SubtitleRenderContent {
  primaryText: string;
  secondText?: string;
}

export interface SubtitleRenderFrame {
  canvas: HTMLCanvasElement;
  primaryStyle: SubtitleStyle;
  /** 副字幕样式（默认回退到 primaryStyle） */
  secondaryStyle?: SubtitleStyle;
  content: SubtitleRenderContent;
  /** 显示模式：默认 Bilingual */
  displayMode?: SubtitleDisplayMode;
  videoHeight: number;
  videoWidth: number;
  videoDisplayWidth: number;
  videoDisplayHeight: number;
}

interface TextBlock {
  lines: string[];
  fontSize: number;
  style: SubtitleStyle;
}

function drawTextLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  style: SubtitleStyle,
  displayFontSize: number,
  scaleMetric: (px: number) => number,
  videoLeft: number,
  videoRight: number,
  centerX: number,
): void {
  if (style.backgroundOpacity > 0) {
    const textMetrics = ctx.measureText(line);
    const textWidth = textMetrics.width;
    const scaledBgPadding = scaleMetric(style.backgroundPadding);
    const ascent = textMetrics.actualBoundingBoxAscent || displayFontSize * 0.8;
    const descent = textMetrics.actualBoundingBoxDescent || displayFontSize * 0.2;
    const textHeight = ascent + descent;
    const bgHeight = textHeight + scaledBgPadding * 2;
    const bgY = y - ascent - scaledBgPadding;

    ctx.fillStyle = `${style.backgroundColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}`;

    let bgX = centerX - textWidth / 2 - scaledBgPadding;
    if (style.textAlign === 'left') bgX = videoLeft - scaledBgPadding;
    if (style.textAlign === 'right') bgX = videoRight - textWidth - scaledBgPadding * 2;

    ctx.beginPath();
    const scaledBgRadius = scaleMetric(style.backgroundRadius);
    ctx.roundRect(
      bgX,
      bgY,
      textWidth + scaledBgPadding * 2,
      bgHeight,
      scaledBgRadius,
    );
    ctx.fill();
  }

  if (style.shadowBlur > 0) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowOffsetX = scaleMetric(style.shadowOffsetX);
    ctx.shadowOffsetY = scaleMetric(style.shadowOffsetY);
    ctx.shadowBlur = scaleMetric(style.shadowBlur);
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
  }

  let textX = centerX;
  if (style.textAlign === 'left') {
    textX = videoLeft;
    ctx.textAlign = 'left';
  } else if (style.textAlign === 'right') {
    textX = videoRight;
    ctx.textAlign = 'right';
  } else {
    ctx.textAlign = 'center';
  }

  const scaledBorderWidth = scaleMetric(style.borderWidth);
  if (scaledBorderWidth > 0) {
    ctx.strokeStyle = `${style.borderColor}${Math.round(style.borderOpacity * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = scaledBorderWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeText(line, textX, y);
  }

  ctx.fillStyle = `${style.color}${Math.round(style.colorOpacity * 255).toString(16).padStart(2, '0')}`;
  ctx.fillText(line, textX, y);

  if (style.textDecoration === 'underline') {
    const textMetrics = ctx.measureText(line);
    const underlineY = y + displayFontSize * 0.08;
    const underlineWidth = Math.max(1, displayFontSize * 0.06);
    let startX = textX - textMetrics.width / 2;
    if (style.textAlign === 'left') startX = textX;
    if (style.textAlign === 'right') startX = textX - textMetrics.width;

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = underlineWidth;
    ctx.strokeStyle = `${style.color}${Math.round(style.colorOpacity * 255).toString(16).padStart(2, '0')}`;
    ctx.beginPath();
    ctx.moveTo(startX, underlineY);
    ctx.lineTo(startX + textMetrics.width, underlineY);
    ctx.stroke();
  }
}

/**
 * 在 Canvas 上绘制一帧字幕（预览与导出共用逻辑）。
 * 支持主/副字幕独立样式与 displayMode：
 * - 'Main'：只渲染主字幕（primaryStyle）
 * - 'Second'：只渲染副字幕（secondaryStyle），位置共享 primary 底边距
 * - 'Bilingual'：主字幕在上、副字幕在下，整体底边距由 primaryStyle 决定
 *   （blocks 自下而上绘制：先副后主 → 视觉上主上副下）
 */
export async function renderSubtitleFrame(frame: SubtitleRenderFrame): Promise<void> {
  const {
    canvas,
    primaryStyle,
    secondaryStyle,
    content,
    displayMode = 'Bilingual',
    videoHeight,
    videoWidth,
    videoDisplayWidth,
    videoDisplayHeight,
  } = frame;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const effectiveSecondaryStyle = secondaryStyle ?? primaryStyle;
  const scaleMetric = (videoPixels: number) =>
    scaleVideoMetric(videoPixels, videoDisplayHeight || videoHeight, videoHeight);

  // 最大宽度与底边距始终基于 primaryStyle（位置与比例共享）
  const maxWidthVideo = resolveLayoutMaxWidth(videoWidth, primaryStyle);
  const maxWidthDisplay = scaleMetric(maxWidthVideo);

  const primaryVideoSize = resolveVideoFontSize(primaryStyle, videoHeight);
  const secondaryVideoSize = resolveVideoFontSize(effectiveSecondaryStyle, videoHeight);

  const showPrimary = displayMode !== 'Second';
  const showSecondary = displayMode !== 'Main' && Boolean(content.secondText?.trim());

  const blocks: TextBlock[] = [];

  // 自下而上绘制：先压入副字幕（底部），再压入主字幕（上方）
  if (showSecondary) {
    await ensureSubtitleFont(effectiveSecondaryStyle, secondaryVideoSize);
    const secondaryLines = layoutSubtitleLines(content.secondText!, effectiveSecondaryStyle, {
      maxWidth: maxWidthDisplay,
      videoHeight,
      fontSizePx: scaleMetric(secondaryVideoSize),
    });
    if (secondaryLines.length > 0) {
      blocks.push({
        lines: secondaryLines,
        fontSize: scaleMetric(secondaryVideoSize),
        style: effectiveSecondaryStyle,
      });
    }
  }

  if (showPrimary) {
    await ensureSubtitleFont(primaryStyle, primaryVideoSize);
    const primaryLines = layoutSubtitleLines(content.primaryText, primaryStyle, {
      maxWidth: maxWidthDisplay,
      videoHeight,
      fontSizePx: scaleMetric(primaryVideoSize),
    });
    if (primaryLines.length > 0) {
      blocks.push({
        lines: primaryLines,
        fontSize: scaleMetric(primaryVideoSize),
        style: primaryStyle,
      });
    }
  }

  if (blocks.length === 0) return;

  const videoLeft = (width - videoDisplayWidth) / 2;
  const videoRight = videoLeft + videoDisplayWidth;
  const centerX = videoLeft + videoDisplayWidth / 2;
  const bottomOffsetVideo = resolveBottomOffset(primaryStyle, videoHeight);
  let bottomY = height - scaleMetric(bottomOffsetVideo);

  for (const block of blocks) {
    ctx.font = buildCanvasFont(block.style, block.fontSize);
    ctx.textBaseline = 'bottom';
    const scaledLetterSpacing = scaleMetric(block.style.letterSpacing);
    ctx.letterSpacing = `${scaledLetterSpacing}px`;

    for (let i = block.lines.length - 1; i >= 0; i--) {
      drawTextLine(
        ctx,
        block.lines[i],
        centerX,
        bottomY,
        block.style,
        block.fontSize,
        scaleMetric,
        videoLeft,
        videoRight,
        centerX,
      );
      bottomY -= block.fontSize * block.style.lineHeight;
    }

    bottomY -= block.fontSize * BLOCK_GAP_RATIO;
  }
}