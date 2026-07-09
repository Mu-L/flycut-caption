import type { SubtitleStyle } from './subtitleStyle';
import {
  resolveVideoFontSize,
  resolveBottomOffset,
  scaleVideoMetric,
  buildCanvasFont,
} from './subtitleMetrics';
import { ensureSubtitleFont } from './subtitleFonts';
import { layoutSubtitleLines, resolveLayoutMaxWidth } from './subtitleLayout';

const SECONDARY_FONT_SCALE = 0.75;
const BLOCK_GAP_RATIO = 0.15;

export interface SubtitleRenderContent {
  primaryText: string;
  secondText?: string;
}

export interface SubtitleRenderFrame {
  canvas: HTMLCanvasElement;
  style: SubtitleStyle;
  content: SubtitleRenderContent;
  videoHeight: number;
  videoWidth: number;
  videoDisplayWidth: number;
  videoDisplayHeight: number;
}

interface TextBlock {
  lines: string[];
  fontSize: number;
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
  const scaledLineHeight = displayFontSize * style.lineHeight;

  if (style.backgroundOpacity > 0) {
    const textMetrics = ctx.measureText(line);
    const textWidth = textMetrics.width;
    const scaledBgPadding = scaleMetric(style.backgroundPadding);

    ctx.fillStyle = `${style.backgroundColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}`;

    let bgX = centerX - textWidth / 2 - scaledBgPadding;
    if (style.textAlign === 'left') bgX = videoLeft + scaledBgPadding;
    if (style.textAlign === 'right') bgX = videoRight - textWidth - scaledBgPadding;

    ctx.beginPath();
    const scaledBgRadius = scaleMetric(style.backgroundRadius);
    ctx.roundRect(
      bgX,
      y - displayFontSize - scaledBgPadding,
      textWidth + scaledBgPadding * 2,
      scaledLineHeight + scaledBgPadding,
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
 * 双语：副字幕靠下，主字幕在上方。
 */
export async function renderSubtitleFrame(frame: SubtitleRenderFrame): Promise<void> {
  const {
    canvas,
    style,
    content,
    videoHeight,
    videoWidth,
    videoDisplayWidth,
    videoDisplayHeight,
  } = frame;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const scaleMetric = (videoPixels: number) =>
    scaleVideoMetric(videoPixels, videoDisplayHeight || videoHeight, videoHeight);

  const videoFontSize = resolveVideoFontSize(style, videoHeight);
  const maxWidthVideo = resolveLayoutMaxWidth(videoWidth, style);
  const maxWidthDisplay = scaleMetric(maxWidthVideo);

  const primaryVideoSize = videoFontSize;
  const secondaryVideoSize = Math.round(videoFontSize * SECONDARY_FONT_SCALE);

  await ensureSubtitleFont(style, primaryVideoSize);

  const primaryLines = layoutSubtitleLines(content.primaryText, style, {
    maxWidth: maxWidthDisplay,
    videoHeight,
    fontSizePx: scaleMetric(primaryVideoSize),
  });

  const blocks: TextBlock[] = [];

  if (content.secondText?.trim()) {
    await ensureSubtitleFont(style, secondaryVideoSize);
    const secondaryLines = layoutSubtitleLines(content.secondText, style, {
      maxWidth: maxWidthDisplay,
      videoHeight,
      fontSizePx: scaleMetric(secondaryVideoSize),
    });
    if (secondaryLines.length > 0) {
      blocks.push({
        lines: secondaryLines,
        fontSize: scaleMetric(secondaryVideoSize),
      });
    }
  }

  if (primaryLines.length > 0) {
    blocks.push({
      lines: primaryLines,
      fontSize: scaleMetric(primaryVideoSize),
    });
  }

  if (blocks.length === 0) return;

  const videoLeft = (width - videoDisplayWidth) / 2;
  const videoRight = videoLeft + videoDisplayWidth;
  const centerX = videoLeft + videoDisplayWidth / 2;
  const bottomOffsetVideo = resolveBottomOffset(style, videoHeight);
  let bottomY = height - scaleMetric(bottomOffsetVideo);

  const scaledLetterSpacing = scaleMetric(style.letterSpacing);

  for (const block of blocks) {
    ctx.font = buildCanvasFont(style, block.fontSize);
    ctx.textBaseline = 'bottom';
    if (scaledLetterSpacing !== 0) {
      ctx.letterSpacing = `${scaledLetterSpacing}px`;
    }

    for (let i = block.lines.length - 1; i >= 0; i--) {
      drawTextLine(
        ctx,
        block.lines[i],
        centerX,
        bottomY,
        style,
        block.fontSize,
        scaleMetric,
        videoLeft,
        videoRight,
        centerX,
      );
      bottomY -= block.fontSize * style.lineHeight;
    }

    bottomY -= block.fontSize * BLOCK_GAP_RATIO;
  }
}