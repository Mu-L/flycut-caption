// FlyCut Caption - 智能视频字幕裁剪工具

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useChunks, useWordChunks, useHasWordTimestamps, useHistoryStore } from '@/stores/historyStore';
import { buildVideoExportSegments } from '@/utils/videoExportSegments';
import { calcDownloadProgress, MEDIA_LOAD_PHASE } from '@/utils/mediaLoadProgress';
import { useThemeStore } from '@/stores/themeStore';
import { useHotkeys } from '@/hooks/useHotkeys';
import { LocaleProvider, useTranslation, useLocale } from '@/contexts/LocaleProvider';
import { EnhancedVideoPlayer } from '@/components/VideoPlayer/EnhancedVideoPlayer';
import type { EnhancedVideoPlayerRef } from '@/components/VideoPlayer/EnhancedVideoPlayer';
import { SubtitleEditorPanel } from '@/components/SubtitleEditor/SubtitleEditorPanel';
import { useASR } from '@/hooks/useASR';
import { ASRSettingsPanel } from '@/components/ProcessingPanel/ASRSettingsPanel';
import { AISettingsPanel } from '@/components/AISettingsPanel';
import { SettingsDialog } from '@/components/ProcessingPanel/SettingsDialog';
import { ExportDialog, type VideoExportOptions } from '@/components/ExportPanel/ExportDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import { ToastContainer, MessageCenterButton } from '@/components/MessageCenter';
import { LanguageSelector } from '@/components/LanguageSelector';
import { BrandLogo } from '@/components/BrandLogo';
import { SubtitleSettings } from '@/components/SubtitleSettings';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  defaultSubtitleStylePair,
  registerSubtitleFonts,
  serializeSubtitleExport,
  getExportFilename,
  getExportMimeType,
  getExportFileTypes,
  applyAspectPreset,
  inferAspectPreset,
  type SubtitleStylePair,
  type SubtitleExportFormat,
  type SubtitleDisplayMode,
} from '@/subtitle';
import { isTauriRuntime } from '@/utils/runtime';
import { cn } from '@/lib/utils';
import {
  useStartVideoProcessing,
  useUpdateVideoProcessingProgress,
  useCompleteVideoProcessing,
  useErrorVideoProcessing
} from '@/stores/messageStore';
import { UnifiedVideoProcessor } from '@/services/UnifiedVideoProcessor';
import { saveFile } from '@/utils/createFileWriter';
import {
  pickVideoExportSaveTarget,
  writeProcessedVideo,
  type VideoExportSaveTarget,
} from '@/utils/exportSavePath';
import { fetchBlobWithProgress, loadMediaFromUrl } from '@/utils/fileUtils';
import { AudioWaveform, Download, Eye, EyeOff, Github, Link2, Maximize2, Play, Redo2, Scissors, Upload, Wand2, Keyboard, Undo2, ZoomIn, ZoomOut, Settings, Loader2, ChevronDown, Video, FileText } from 'lucide-react';
import { runSmartCutBlank } from '@/utils/smartCutBlank';
import { toast } from 'sonner';
import type { SubtitleChunk } from '@/types/subtitle';
import type { VideoFile, VideoSegment, VideoProcessingProgress } from '@/types/video';
import type { VideoProcessingOptions, VideoEngineType } from '@/types/videoEngine';
import type { FlyCutCaptionProps } from './types';
import { defaultConfig } from './types';
// 示例视频：云端托管（本地 src/assets/demo.mp4 仅保留给集成测试）
const SAMPLE_VIDEO_URL = 'https://fly-cut.oss-cn-hangzhou.aliyuncs.com/demo/sample-video.mp4';
const SAMPLE_VIDEO_NAME = 'sample-video.mp4';

type AimuTab = 'style' | 'tools' | 'options' | 'api';

interface BrowserPerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const waveformDecodeLimitBytes = 180 * 1024 * 1024;

const formatTimelineTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

async function extractWaveformPeaks(videoFile: VideoFile): Promise<number[] | null> {
  if (typeof window === 'undefined') return null;
  if (!videoFile.file.size || videoFile.file.size > waveformDecodeLimitBytes) return null;

  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  const audioContext = new AudioContextClass();

  try {
    const arrayBuffer = await videoFile.file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const sampleCount = Math.round(clamp(audioBuffer.duration * 24, 320, 2400));
    const blockSize = Math.max(1, Math.floor(audioBuffer.length / sampleCount));
    const peaks = new Array<number>(sampleCount).fill(0);
    let maxPeak = 0;

    for (let peakIndex = 0; peakIndex < sampleCount; peakIndex++) {
      const start = peakIndex * blockSize;
      const end = Math.min(audioBuffer.length, start + blockSize);
      let sum = 0;
      let count = 0;

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
          const sample = channelData[sampleIndex] || 0;
          sum += sample * sample;
          count += 1;
        }
      }

      const rms = count > 0 ? Math.sqrt(sum / count) : 0;
      peaks[peakIndex] = rms;
      maxPeak = Math.max(maxPeak, rms);
    }

    if (maxPeak <= 0) return null;
    return peaks.map(peak => clamp(Math.sqrt(peak / maxPeak), 0, 1));
  } catch (error) {
    console.warn('音频波形解码失败，使用合成波形:', error);
    return null;
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

const TIMELINE_ZOOM_LEVELS = [
  { pxPerSec: 5,   minorStep: 10,  majorStep: 60 },  // 10 秒/小格, 1 分钟/大格
  { pxPerSec: 10,  minorStep: 5,   majorStep: 30 },  // 5 秒/小格, 30 秒/大格
  { pxPerSec: 20,  minorStep: 2,   majorStep: 10 },  // 2 秒/小格, 10 秒/大格
  { pxPerSec: 40,  minorStep: 1,   majorStep: 5 },   // 1 秒/小格, 5 秒/大格
  { pxPerSec: 80,  minorStep: 1,   majorStep: 2 },   // 1 秒/小格, 2 秒/大格
  { pxPerSec: 150, minorStep: 0.5, majorStep: 2 },   // 0.5 秒/小格, 2 秒/大格
  { pxPerSec: 300, minorStep: 0.2, majorStep: 1 },   // 0.2 秒/小格, 1 秒/大格
  { pxPerSec: 600, minorStep: 0.1, majorStep: 0.5 }, // 0.1 秒/小格, 0.5 秒/大格
] as const;

function TimelineWaveform({
  currentTime,
  duration,
  chunks,
  onSeek,
  isASRLoading,
  asrProgress,
  isVideoProcessing,
  videoProgress,
  mediaWaveformPeaks,
}: {
  currentTime: number;
  duration: number;
  chunks: Array<Pick<SubtitleChunk, 'id' | 'timestamp' | 'deleted' | 'text' | 'secondText'>>;
  onSeek?: (time: number) => void;
  /** ASR 是否正在识别 */
  isASRLoading?: boolean;
  /** ASR 进度信息 */
  asrProgress?: import('@/types/subtitle').ASRProgress | null;
  /** 视频是否正在导出处理 */
  isVideoProcessing?: boolean;
  /** 视频导出进度 */
  videoProgress?: VideoProcessingProgress | null;
  mediaWaveformPeaks?: number[] | null;
}) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore(state => state.resolvedTheme);
  const viewportRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [showSubtitleLayer, setShowSubtitleLayer] = useState(true);
  const [viewportMetrics, setViewportMetrics] = useState({
    width: 0,
    height: 0,
    scrollLeft: 0,
  });
  const safeDuration = Math.max(duration, 1);

  const minZoomIndex = 0;
  const maxZoomIndex = TIMELINE_ZOOM_LEVELS.length - 1;
  const currentZoomLevel = TIMELINE_ZOOM_LEVELS[clamp(zoomIndex, minZoomIndex, maxZoomIndex)];
  const pixelsPerSecond = currentZoomLevel.pxPerSec;
  const minorTickStep = currentZoomLevel.minorStep;
  const majorTickStep = currentZoomLevel.majorStep;

  // 时间轴总宽度（像素）= 媒体时长 × 像素密度，至少铺满视口
  const timelineWidth = Math.max(safeDuration * pixelsPerSecond, viewportMetrics.width);

  // 播放头位置（像素）
  const playheadPosition = clamp(currentTime, 0, safeDuration) * pixelsPerSecond;

  const zoomPercent = pixelsPerSecond;

  const activeRanges = useMemo(() => (
    chunks
      .filter(chunk => !chunk.deleted)
      .map(chunk => chunk.timestamp)
      .sort((a, b) => a[0] - b[0])
  ), [chunks]);

  const waveformPeaks = useMemo(() => {
    // 初始状态（无媒体）：不生成合成波形，避免空时间轴出现波形残留
    if (duration <= 0) return [];
    if (mediaWaveformPeaks?.length) {
      return mediaWaveformPeaks;
    }

    const sampleCount = Math.max(320, Math.ceil(safeDuration * 24));
    let rangeIndex = 0;

    return Array.from({ length: sampleCount }, (_, index) => {
      const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
      const time = progress * safeDuration;

      while (
        rangeIndex < activeRanges.length - 1 &&
        activeRanges[rangeIndex][1] < time
      ) {
        rangeIndex += 1;
      }

      const activeRange = activeRanges[rangeIndex];
      const isActive = activeRanges.length === 0 ||
        (activeRange && time >= activeRange[0] && time <= activeRange[1]);

      if (!isActive) return 0;

      const signal =
        Math.abs(Math.sin(index * 0.37)) * 0.38 +
        Math.abs(Math.sin(index * 0.11 + 1.7)) * 0.32 +
        Math.abs(Math.sin(index * 0.023 + 0.4)) * 0.22;
      const pulse = index % 29 === 0 ? 0.2 : 0;

      return clamp((signal + pulse) * 0.72 + 0.12, 0.08, 0.96);
    });
  }, [activeRanges, mediaWaveformPeaks, safeDuration, duration]);

  const handleZoomOut = useCallback(() => {
    setZoomIndex((index) => Math.max(minZoomIndex, index - 1));
  }, [minZoomIndex]);

  const handleZoomIn = useCallback(() => {
    setZoomIndex((index) => Math.min(maxZoomIndex, index + 1));
  }, [maxZoomIndex]);

  const handleFitTimeline = useCallback(() => {
    // 选择让整段媒体刚好铺满视口的档位（向上取整到最近的可用档位）
    const viewportWidth = viewportRef.current?.clientWidth ?? 0;
    if (viewportWidth <= 0) return;
    const targetPxPerSec = viewportWidth / safeDuration;
    let fitIndex = 0;
    for (let i = 0; i < TIMELINE_ZOOM_LEVELS.length; i++) {
      if (TIMELINE_ZOOM_LEVELS[i].pxPerSec >= targetPxPerSec) {
        fitIndex = i;
        break;
      }
      fitIndex = i;
    }
    setZoomIndex(fitIndex);
    viewportRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [safeDuration]);

  const handleTimelineClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - bounds.left;
    const clickTime = clickX / pixelsPerSecond;
    onSeek(Math.max(0, Math.min(safeDuration, clickTime)));
  }, [duration, onSeek, safeDuration, pixelsPerSecond]);

  // 自动滚动使播放头保持可见
  useEffect(() => {
    if (duration <= 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const visibleStart = viewport.scrollLeft;
    const visibleEnd = visibleStart + viewport.clientWidth;
    const margin = 48;

    if (playheadPosition < visibleStart + margin || playheadPosition > visibleEnd - margin) {
      viewport.scrollTo({
        left: Math.max(0, playheadPosition - viewport.clientWidth / 2),
        behavior: 'smooth',
      });
    }
  }, [duration, playheadPosition]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frameId = 0;
    const updateMetrics = () => {
      frameId = 0;
      const nextMetrics = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
        scrollLeft: viewport.scrollLeft,
      };

      setViewportMetrics(previous => (
        previous.width === nextMetrics.width &&
        previous.height === nextMetrics.height &&
        previous.scrollLeft === nextMetrics.scrollLeft
          ? previous
          : nextMetrics
      ));
    };

    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateMetrics);
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleUpdate)
      : null;

    resizeObserver?.observe(viewport);
    viewport.addEventListener('scroll', scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      viewport.removeEventListener('scroll', scheduleUpdate);
    };
  }, []);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || viewportMetrics.width <= 0 || viewportMetrics.height <= 0) return;
    // 初始状态（无媒体）：不绘制刻度/网格/波形，由空状态提示层占位
    if (duration <= 0) return;

    const width = Math.max(1, Math.floor(viewportMetrics.width));
    const height = Math.max(1, Math.floor(viewportMetrics.height));
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const panelColor = rootStyles.getPropertyValue('--aimu-bg-input').trim() || '#f0f0f4';
    const borderColor = rootStyles.getPropertyValue('--aimu-border').trim() || '#e0e0e6';
    const borderLightColor = rootStyles.getPropertyValue('--aimu-border-light').trim() || '#ececf0';
    const textColor = rootStyles.getPropertyValue('--aimu-text-secondary').trim() || '#5a5a62';
    const mutedColor = rootStyles.getPropertyValue('--aimu-text-muted').trim() || '#8d9095';
    const coralColor = rootStyles.getPropertyValue('--aimu-accent-coral').trim() || '#e85555';

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = panelColor;
    context.fillRect(0, 0, width, height);

    const rulerHeight = 24;
    const waveformTop = 32;
    const waveformBottom = height - 4;
    const waveformHeight = Math.max(1, waveformBottom - waveformTop);
    const centerY = waveformTop + waveformHeight / 2;

    context.strokeStyle = borderColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, rulerHeight + 0.5);
    context.lineTo(width, rulerHeight + 0.5);
    context.moveTo(0, centerY + 0.5);
    context.lineTo(width, centerY + 0.5);
    context.stroke();

    const visibleStartPx = viewportMetrics.scrollLeft;
    const visibleEndPx = visibleStartPx + width;
    // 刻度只覆盖真实媒体时长
    const timelineEndSecond = safeDuration;
    const tickStep = minorTickStep;
    const ticksPerLabel = Math.max(1, Math.round(majorTickStep / minorTickStep));
    // 以 tick 索引迭代，避免浮点累加误差
    const firstTickIndex = Math.max(0, Math.floor(visibleStartPx / pixelsPerSecond / tickStep));
    const lastTickIndex = Math.min(
      Math.ceil(timelineEndSecond / tickStep),
      Math.ceil(visibleEndPx / pixelsPerSecond / tickStep)
    );

    context.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    context.textBaseline = 'top';

    for (let tickIndex = firstTickIndex; tickIndex <= lastTickIndex; tickIndex++) {
      const second = tickIndex * tickStep;
      const x = Math.round(second * pixelsPerSecond - visibleStartPx) + 0.5;
      const isMajor = tickIndex % ticksPerLabel === 0;

      context.strokeStyle = isMajor ? textColor : mutedColor;
      context.globalAlpha = isMajor ? 0.9 : 0.45;
      context.beginPath();
      context.moveTo(x, isMajor ? 8 : 14);
      context.lineTo(x, rulerHeight);
      context.stroke();

      if (isMajor) {
        context.globalAlpha = 1;
        context.fillStyle = textColor;
        context.fillText(formatTimelineTime(second), x + 4, 4);
      }
    }

    context.globalAlpha = 0.55;
    context.strokeStyle = borderLightColor;
    context.beginPath();
    for (let x = 0; x <= width; x += Math.max(24, pixelsPerSecond)) {
      context.moveTo(Math.round(x) + 0.5, waveformTop);
      context.lineTo(Math.round(x) + 0.5, waveformBottom);
    }
    context.stroke();

    const barStep = pixelsPerSecond < 12 ? 2 : pixelsPerSecond < 40 ? 3 : 4;
    const barWidth = clamp(barStep * 0.58, 1, 3);
    context.fillStyle = coralColor;

    for (let x = 0; x <= width; x += barStep) {
      const time = (visibleStartPx + x) / pixelsPerSecond;
      if (time < 0 || time > safeDuration) continue;

      const peakIndex = Math.floor((time / safeDuration) * (waveformPeaks.length - 1));
      const peak = waveformPeaks[peakIndex] ?? 0;
      if (peak <= 0.01) continue;

      const barHeight = peak * waveformHeight * 0.88;
      const y = centerY - barHeight / 2;

      context.globalAlpha = 0.34 + peak * 0.52;
      if (typeof context.roundRect === 'function') {
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      } else {
        context.fillRect(x, y, barWidth, barHeight);
      }
    }

    context.globalAlpha = 1;
  }, [
    pixelsPerSecond,
    minorTickStep,
    majorTickStep,
    resolvedTheme,
    safeDuration,
    viewportMetrics,
    waveformPeaks,
    duration,
  ]);

  return (
    <div className="h-[132px] shrink-0 border-t border-aimu-border bg-aimu-panel">
      <div className="flex h-8 items-center justify-between border-b border-aimu-border px-3">
        <div className="flex items-center gap-1.5 text-xs text-aimu-text-secondary">
          <AudioWaveform className="h-4 w-4 text-aimu-coral" />
          <span className="font-medium text-aimu-text-primary">{t('components.workstation.timeline')}</span>
          {isASRLoading ? (
            <span className="flex items-center gap-1.5 text-aimu-coral">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="font-mono text-[11px]">
                {asrProgress?.data || t('messages.asr.modelLoading')}
                {asrProgress?.progress !== undefined ? ` · ${Math.round(asrProgress.progress)}%` : ''}
              </span>
            </span>
          ) : isVideoProcessing ? (
            <span className="flex items-center gap-1.5 text-aimu-coral">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="font-mono text-[11px]">
                {videoProgress?.message || t('components.workstation.exportProgress')}
                {videoProgress?.progress !== undefined ? ` · ${Math.round(videoProgress.progress)}%` : ''}
              </span>
            </span>
          ) : duration > 0 ? (
            <span className="font-mono text-[11px] text-aimu-text-muted">{formatTimelineTime(currentTime)} / {formatTimelineTime(duration)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-aimu-text-muted">
          <button
            type="button"
            onClick={() => setShowSubtitleLayer(isVisible => !isVisible)}
            aria-pressed={showSubtitleLayer}
            className={cn(
              'rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary',
              showSubtitleLayer && 'text-aimu-coral'
            )}
            title={showSubtitleLayer
              ? t('components.workstation.hideSubtitleOverlay')
              : t('components.workstation.showSubtitleOverlay')}
          >
            {showSubtitleLayer ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary" title={t('components.workstation.cut')}>
            <Scissors className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoomIndex <= minZoomIndex}
            className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={t('components.subtitleEditor.zoomOut')}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center font-mono text-[10px] tabular-nums text-aimu-text-secondary">
            {zoomPercent}px/s
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoomIndex >= maxZoomIndex}
            className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={t('components.subtitleEditor.zoomIn')}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitTimeline}
            className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary"
            title={t('components.workstation.fit')}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="h-[100px] px-3 py-2">
        <div ref={viewportRef} className="h-full overflow-x-auto overflow-y-hidden">
          <div
            data-testid="timeline-ruler"
            className="relative h-full cursor-pointer rounded border border-aimu-border bg-aimu-input"
            style={{ width: `${timelineWidth}px`, minWidth: '100%' }}
            onClick={handleTimelineClick}
          >
            <canvas
              ref={waveformCanvasRef}
              data-testid="timeline-waveform-canvas"
              className="pointer-events-none sticky left-0 top-0 z-0 block h-full"
              aria-hidden="true"
            />
            {duration <= 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-aimu-text-muted">
                {t('components.workstation.emptyTimelineHint')}
              </div>
            )}
            {showSubtitleLayer && chunks
              .filter(chunk => !chunk.deleted)
              .map((chunk) => {
              const leftPx = chunk.timestamp[0] * pixelsPerSecond;
              const widthPx = (chunk.timestamp[1] - chunk.timestamp[0]) * pixelsPerSecond;
              const label = [chunk.text, chunk.secondText].filter(Boolean).join(' / ');
              return (
                <div
                  key={chunk.id}
                  className={cn(
                    'absolute bottom-1 top-8 z-10 flex cursor-pointer items-center overflow-hidden rounded-sm border px-1.5 shadow-sm',
                    'border-aimu-purple/65 bg-aimu-purple/30'
                  )}
                  style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  title={label}
                >
                  <span
                    className={cn(
                      'min-w-0 truncate text-[10px] font-medium leading-none opacity-75',
                      'text-aimu-text-primary'
                    )}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
            {duration > 0 && (
              <div
                className="pointer-events-none absolute bottom-1 top-8 z-20 w-px bg-white shadow-[0_0_0_1px_rgba(245,108,108,0.65)]"
                style={{ left: `${playheadPosition}px` }}
              >
                <div className="absolute -left-1.5 -top-1 h-3 w-3 rounded-full bg-aimu-coral" />
              </div>
            )}
            {(isASRLoading || isVideoProcessing) && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-aimu-panel/70 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2 rounded-lg border border-aimu-border bg-aimu-panel px-4 py-2 text-[11px] text-aimu-coral shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="font-medium">
                      {isASRLoading
                        ? (asrProgress?.data || t('messages.asr.asrStarted'))
                        : (videoProgress?.message || t('components.workstation.exportProgress'))}
                    </span>
                    {(isASRLoading ? asrProgress?.progress : videoProgress?.progress) !== undefined && (
                      <span className="font-mono text-aimu-text-muted">
                        · {Math.round((isASRLoading ? asrProgress?.progress : videoProgress?.progress) ?? 0)}%
                      </span>
                    )}
                  </div>
                  {isVideoProcessing && videoProgress && (
                    <div className="h-1.5 w-48 overflow-hidden rounded-full bg-aimu-border">
                      <div
                        className="h-full rounded-full bg-aimu-coral transition-all duration-300"
                        style={{ width: `${videoProgress.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * FlyCut Caption React Component
 *
 * A complete video subtitle editing component with AI-powered speech recognition,
 * visual editing interface, and video processing capabilities.
 *
 * @example
 * ```tsx
 * import { FlyCutCaption } from '@flycut/caption-react'
 * import '@flycut/caption-react/styles'
 *
 * function App() {
 *   return (
 *     <FlyCutCaption
 *       config={{
 *         theme: 'auto',
 *         language: 'zh-CN',
 *         asrLanguage: 'auto',
 *         enableDragDrop: true,
 *         enableExport: true,
 *         enableVideoProcessing: true,
 *         maxFileSize: 500,
 *         supportedFormats: ['mp4', 'webm', 'avi', 'mov', 'mp3', 'wav', 'ogg']
 *       }}
 *       onReady={() => console.log('FlyCut Caption is ready')}
 *       onFileSelected={(file) => console.log('File selected:', file.name)}
 *       onSubtitleGenerated={(subtitles) => console.log('Subtitles generated:', subtitles.length)}
 *       onSubtitleChanged={(subtitles) => console.log('Subtitles changed:', subtitles.length)}
 *       onVideoProcessed={(blob, filename) => console.log('Video processed:', filename)}
 *       onExportComplete={(blob, filename) => console.log('Export complete:', filename)}
 *       onError={(error) => console.error('Error:', error)}
 *       onProgress={(stage, progress) => console.log(`${stage}: ${progress}%`)}
 *     />
 *   )
 * }
 * ```
 */
function FlyCutCaptionContent(props: FlyCutCaptionProps) {
  const {
    className,
    style,
    config = {},
    onReady,
    onFileSelected,
    onSubtitleChanged,
    onVideoProcessed,
    onExportComplete,
    onError,
    onProgress,
    onLanguageChange,
    ...otherProps
  } = props;

  // Merge user config with defaults
  const mergedConfig = useMemo(() => ({
    ...defaultConfig,
    ...config
  }), [config]);

  const stage = useAppStore(state => state.stage);
  const videoFile = useAppStore(state => state.videoFile);
  const chunks = useChunks();
  const wordChunks = useWordChunks();
  const hasWordTimestamps = useHasWordTimestamps();
  const insertBlankChunks = useHistoryStore(state => state.insertBlankChunks);
  const smartCutSilenceThreshold = useAppStore(state => state.smartCutSilenceThreshold);
  const videoDuration = useAppStore(state => state.videoPlayerState.duration);

  // 内存使用情况状态 (Aimu 风格)
  const [memory, setMemory] = useState({ used: '42.63 MB', allocated: '54.17 MB', limit: '3.5 GB' });
  const [mediaWaveformPeaks, setMediaWaveformPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    const updateMemory = () => {
      const performanceWithMemory =
        typeof window !== 'undefined'
          ? window.performance as Performance & { memory?: BrowserPerformanceMemory }
          : undefined;

      if (performanceWithMemory?.memory) {
        const mem = performanceWithMemory.memory;
        const limitGB = mem.jsHeapSizeLimit / 1024 / 1024 / 1024;
        setMemory({
          used: `${(mem.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
          allocated: `${(mem.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
          limit: isNaN(limitGB) ? '4.0 GB' : `${limitGB.toFixed(1)} GB`
        });
      } else {
        const used = (40 + Math.random() * 5).toFixed(2);
        const allocated = (50 + Math.random() * 5).toFixed(2);
        setMemory({
          used: `${used} MB`,
          allocated: `${allocated} MB`,
          limit: '4.0 GB'
        });
      }
    };

    updateMemory();
    const interval = setInterval(updateMemory, 5000);
    return () => clearInterval(interval);
  }, []);

  // Tab 状态 (Aimu 风格)
  const [activeTab, setActiveTab] = useState<AimuTab>('style');

  // 主题管理
  const { resolvedTheme } = useThemeStore();
  const effectiveTheme = mergedConfig.theme === 'auto' ? resolvedTheme : mergedConfig.theme;

  // 国际化
  const { t } = useTranslation();
  const { language, setLanguage } = useLocale();

  // 语言选项
  const languageOptions = [
    { code: 'zh', name: '中文', nativeName: '中文' },
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' }
  ];

  const tabOptions: Array<{ id: AimuTab; label: string }> = [
    { id: 'style', label: t('components.workstation.style') },
    { id: 'tools', label: t('components.workstation.tools') },
    { id: 'options', label: t('components.workstation.options') },
    { id: 'api', label: t('components.workstation.api') },
  ];

  const plannedFeatures = {
    tools: [
      {
        title: t('components.workstation.swapTitle'),
        description: t('components.workstation.swapDescription'),
      },
      {
        title: t('components.workstation.aiTranslationTitle'),
        description: t('components.workstation.aiTranslationDescription'),
      },
      {
        title: t('components.workstation.ttsTitle'),
        description: t('components.workstation.ttsDescription'),
      },
    ],
    options: [
      {
        title: t('components.workstation.timelineWaveformTitle'),
        description: t('components.workstation.timelineWaveformDescription'),
      },
      {
        title: t('components.workstation.shortcutEditorTitle'),
        description: t('components.workstation.shortcutEditorDescription'),
      },
      {
        title: t('components.workstation.batchOperationsTitle'),
        description: t('components.workstation.batchOperationsDescription'),
      },
    ],
    api: [
      {
        title: t('components.workstation.onlineHardcodingTitle'),
        description: t('components.workstation.onlineHardcodingDescription'),
      },
      {
        title: t('components.workstation.videoTranscodingTitle'),
        description: t('components.workstation.videoTranscodingDescription'),
      },
      {
        title: t('components.workstation.externalAsrTitle'),
        description: t('components.workstation.externalAsrDescription'),
      },
    ],
  };

  const renderFeatureItems = (items: Array<{ title: string; description: string }>) => (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.title} className="flex items-center gap-2 p-2 border border-border rounded bg-muted/5">
          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0" />
          <div className="flex-1">
            <div className="text-xs font-semibold">{item.title}</div>
            <div className="text-[10px] text-muted-foreground">{item.description}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // Component is ready, render the main content
  // 初始状态为空：不再自动填充演示字幕，由「使用示例视频」按钮显式加载

  useEffect(() => {
    let cancelled = false;

    if (!videoFile) {
      setMediaWaveformPeaks(null);
      return () => {
        cancelled = true;
      };
    }

    setMediaWaveformPeaks(null);
    extractWaveformPeaks(videoFile).then((peaks) => {
      if (!cancelled) {
        setMediaWaveformPeaks(peaks);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [videoFile]);

  // ASR 语音识别：进入 transcribe 阶段后自动开始识别，
  // 不再弹出 ASR 窗口与消息，改由字幕编辑器/时间轴展示加载状态。
  const { isASRLoading, asrProgress, startASR } = useASR();
  const asrStartedRef = useRef(false);

  useEffect(() => {
    if (stage === 'transcribe' && videoFile && !isASRLoading && !asrStartedRef.current) {
      asrStartedRef.current = true;
      startASR(videoFile);
    }
    // 进入非 transcribe 阶段时重置标记，允许下次重新触发
    if (stage !== 'transcribe') {
      asrStartedRef.current = false;
    }
  }, [stage, videoFile, isASRLoading, startASR]);

  // Component ready effect
  useEffect(() => {
    // Initialize component
    const timer = setTimeout(() => {
      onReady?.()
    }, 100) // Small delay to ensure component is fully mounted

    return () => clearTimeout(timer)
  }, [onReady]);

  // 初始化主题 - 确保 wrapper 与全局 DOM 使用同一套变量
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(effectiveTheme);
  }, [effectiveTheme]);

  // 消息中心钩子
  const startVideoProcessing = useStartVideoProcessing();
  const updateVideoProcessingProgress = useUpdateVideoProcessingProgress();
  const completeVideoProcessing = useCompleteVideoProcessing();
  const errorVideoProcessing = useErrorVideoProcessing();

  // 启用快捷键
  useHotkeys({
    enableHistoryHotkeys: true,
    enableGlobalHotkeys: true, // 全局启用，即使焦点不在特定元素上也能工作
  });

  // 在组件层用 useMemo 做过滤，保证只有 chunks 引用变更时才重新计算
  const activeChunks = useMemo(
    () => chunks.filter(c => !c.deleted),
    [chunks]
  );

  const currentTime = useAppStore(state => state.currentTime);
  const setCurrentTime = useAppStore(state => state.setCurrentTime);
  const setError = useAppStore(state => state.setError);

  // 视频处理相关状态
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoProgress, setVideoProgress] = useState<VideoProcessingProgress | null>(null);
  const processingMessageIdRef = useRef<string | null>(null);
  const exportSaveTargetRef = useRef<VideoExportSaveTarget | null>(null);
  const [currentEngine, setCurrentEngine] = useState<VideoEngineType | null>(null);
  const processorRef = useRef<UnifiedVideoProcessor | null>(null);

  // 导出对话框状态
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogType, setExportDialogType] = useState<'subtitles' | 'video'>('video');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 字幕样式状态：主/副字幕独立样式对，位置（底边距/比例）共享 primary
  const [subtitleStylePair, setSubtitleStylePair] = useState<SubtitleStylePair>(() => defaultSubtitleStylePair);
  // 显示模式（控制播放器预览），持久化在 appStore
  const display = useAppStore(state => state.display);
  const setDisplay = useAppStore(state => state.setDisplay);

  useEffect(() => {
    registerSubtitleFonts();
  }, []);

  // 视频播放器引用
  const videoPlayerRef = useRef<EnhancedVideoPlayerRef>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [isUrlLoading, setIsUrlLoading] = useState(false);
  const [urlLoadProgress, setUrlLoadProgress] = useState<number | null>(null);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [fileLoadProgress, setFileLoadProgress] = useState<number | null>(null);
  const [isSampleLoading, setIsSampleLoading] = useState(false);
  const [sampleLoadProgress, setSampleLoadProgress] = useState<number | null>(null);

  const isMediaLoading = isFileLoading || isSampleLoading || isUrlLoading;

  const timelineDuration = useMemo(() => {
    const chunkEndTime = chunks.reduce((maxTime, chunk) => Math.max(maxTime, chunk.timestamp[1]), 0);
    return Math.max(videoFile?.duration || 0, chunkEndTime);
  }, [chunks, videoFile?.duration]);

  const handleTimelineSeek = useCallback((time: number) => {
    const nextTime = Math.max(0, Math.min(timelineDuration, time));
    setCurrentTime(nextTime);
    videoPlayerRef.current?.seekTo(nextTime);
  }, [setCurrentTime, timelineDuration]);


  // const availableEngines = UnifiedVideoProcessor.getSupportedEngines();

  const handleProgress = useCallback((progressData: VideoProcessingProgress) => {
    setVideoProgress(progressData);
    const messageId = processingMessageIdRef.current;
    if (messageId) {
      updateVideoProcessingProgress(messageId, progressData);
    }
    onProgress?.(progressData.stage, progressData.progress);
  }, [updateVideoProcessingProgress, onProgress]);

  const processVideo = useCallback(async (
    videoFile: VideoFile,
    segments: VideoSegment[],
    options?: VideoProcessingOptions
  ) => {
    if (isProcessing) {
      console.warn(t('messages.fileUpload.processingFile'));
      return;
    }

    let messageId: string | null = null;

    try {
      setIsProcessing(true);
      setVideoProgress({
        stage: 'analyzing',
        progress: 0,
        message: t('components.workstation.exportProgress'),
      });

      // 开始视频处理消息
      messageId = startVideoProcessing(t('messages.fileUpload.processingFile'));
      processingMessageIdRef.current = messageId;

      // 创建/更新处理器进度回调
      if (!processorRef.current) {
        processorRef.current = new UnifiedVideoProcessor(handleProgress);
      } else {
        processorRef.current.setProgressCallback(handleProgress);
      }

      const resolvedOptions: VideoProcessingOptions = {
        quality: 'medium',
        preserveAudio: true,
        ...options,
        outputPath: options?.outputPath ?? exportSaveTargetRef.current?.outputPath,
      };

      // 初始化处理器（如果还没有初始化或需要切换引擎）
      const engineType = await processorRef.current.initialize(
        videoFile,
        resolvedOptions.engine || currentEngine || undefined
      );
      setCurrentEngine(engineType);

      // 处理视频
      const resultBlob = await processorRef.current.processVideo(segments, resolvedOptions);

      const saveTarget = exportSaveTargetRef.current;
      const filename = saveTarget?.filename
        ?? `cut_video_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)}.${resolvedOptions.format || 'mp4'}`;

      let savedPath: string | undefined;
      if (saveTarget?.outputPath) {
        savedPath = saveTarget.outputPath;
      } else if (saveTarget) {
        savedPath = await writeProcessedVideo(resultBlob, saveTarget);
      }

      // 完成处理
      if (messageId) {
        const hasUsableBlob = resultBlob.size > 0;
        completeVideoProcessing(
          messageId,
          hasUsableBlob ? resultBlob : null,
          filename,
          savedPath,
        );
        if (hasUsableBlob) {
          onVideoProcessed?.(resultBlob, filename);
        } else if (savedPath) {
          onExportComplete?.(resultBlob, savedPath);
        }
      }

    } catch (error) {
      console.error('视频处理失败:', error);
      console.error('视频处理错误详情:', {
        videoFile: videoFile?.name,
        segments: segments?.length,
        options,
        stack: error instanceof Error ? error.stack : undefined
      });

      if (messageId) {
        errorVideoProcessing(messageId, error instanceof Error ? error.message : '未知错误');
      }
      onError?.(error instanceof Error ? error : new Error('Unknown error'));
    } finally {
      setIsProcessing(false);
      setVideoProgress(null);
      processingMessageIdRef.current = null;
      exportSaveTargetRef.current = null;
    }
  }, [isProcessing, currentEngine, startVideoProcessing, completeVideoProcessing, errorVideoProcessing, handleProgress, onVideoProcessed, onExportComplete, onError, t]);


  const [videoMeta, setVideoMeta] = useState({ width: 1920, height: 1080 });

  // 导出字幕
  const handleExportSubtitles = useCallback(async (format: SubtitleExportFormat, exportMode: SubtitleDisplayMode) => {
    const keptChunks = chunks.filter(chunk => !chunk.deleted);
    if (keptChunks.length === 0) {
      toast.error(t('messages.subtitle.emptySubtitleText'));
      return;
    }

    try {
      const content = serializeSubtitleExport(format, keptChunks, {
        ass: {
          playResX: videoMeta.width,
          playResY: videoMeta.height,
          stylePair: subtitleStylePair,
          exportMode,
        },
        exportMode,
      });

      const filename = getExportFilename(format);
      const types = getExportFileTypes(format);
      const blob = new Blob([content], { type: getExportMimeType(format) });
      await saveFile(blob, filename, types);
      onExportComplete?.(blob, filename);
    } catch (error) {
      console.error('字幕导出失败:', error);
      const detail = error instanceof Error ? error.message : t('common.error');
      toast.error(t('messages.subtitle.exportFailed'), { description: detail });
    }
  }, [chunks, videoMeta, subtitleStylePair, onExportComplete, t]);

  const handleFileSelect = useCallback((selectedVideoFile: VideoFile) => {
    console.log('文件选择完成:', selectedVideoFile);
    // 清除演示字幕与历史，避免与真实 ASR 流程冲突
    useHistoryStore.getState().reset();
    // 清除上次的 ASR 进度/错误状态
    useAppStore.getState().clearASRProgress();
    // 使用 appStore 的 setVideoFile 方法，它会自动切换到 'transcribe' 阶段
    const setVideoFile = useAppStore.getState().setVideoFile;
    setVideoFile(selectedVideoFile);
    onFileSelected?.(selectedVideoFile);
  }, [onFileSelected]);

  // 加载示例视频：拉取真实视频数据后走标准 ASR 流程（与手动上传一致），
  // 由模型识别生成字幕，而不是显示 mock 内容。
  const handleLoadSampleVideo = useCallback(async () => {
    if (isSampleLoading) return;

    useHistoryStore.getState().reset();
    useAppStore.getState().clearASRProgress();
    setIsSampleLoading(true);
    setSampleLoadProgress(MEDIA_LOAD_PHASE.START);

    try {
      const { blob } = await fetchBlobWithProgress(SAMPLE_VIDEO_URL, (loaded, total) => {
        setSampleLoadProgress(calcDownloadProgress(loaded, total));
      });
      const file = new File([blob], SAMPLE_VIDEO_NAME, { type: 'video/mp4' });
      const objectUrl = URL.createObjectURL(file);

      setSampleLoadProgress(MEDIA_LOAD_PHASE.METADATA);
      const duration = await new Promise<number>((resolve) => {
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
        probe.onerror = () => resolve(0);
        probe.src = objectUrl;
      });

      setSampleLoadProgress(MEDIA_LOAD_PHASE.FINALIZING);
      const sampleVideoFile: VideoFile = {
        file,
        url: objectUrl,
        size: blob.size,
        type: 'video/mp4',
        name: SAMPLE_VIDEO_NAME,
        duration,
      };
      useAppStore.getState().setVideoFile(sampleVideoFile);
      onFileSelected?.(sampleVideoFile);
      setSampleLoadProgress(MEDIA_LOAD_PHASE.COMPLETE);
    } catch (error) {
      console.error('加载示例视频失败:', error);
      toast.error(t('messages.asr.loadSampleFailed'));
    } finally {
      setIsSampleLoading(false);
      setSampleLoadProgress(null);
    }
  }, [isSampleLoading, onFileSelected, t]);

  // Tauri 环境下通过原生文件选择器选择本地文件，拿到本地路径
  const handleTauriFileSelect = useCallback(async () => {
    const isTauri = '__TAURI_INTERNALS__' in window;
    if (!isTauri) return false;

    setIsFileLoading(true);
    setFileLoadProgress(MEDIA_LOAD_PHASE.START);

    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
      const filePath = await invoke<string | null>('pick_media_file');
      if (!filePath) return true; // 用户取消

      setFileLoadProgress(MEDIA_LOAD_PHASE.METADATA);
      const fileName = filePath.split(/[/\\]/).pop() || 'video';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
        avi: 'video/x-msvideo', mkv: 'video/x-matroska', ogg: 'video/ogg',
        mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
        flac: 'audio/flac', aac: 'audio/aac',
      };
      const selectedVideoFile: VideoFile = {
        file: new File([], fileName, { type: mimeMap[ext] || '' }),
        url: convertFileSrc(filePath),
        duration: 0,
        size: 0,
        type: mimeMap[ext] || '',
        name: fileName,
        path: filePath,
      };

      setFileLoadProgress(MEDIA_LOAD_PHASE.FINALIZING);
      handleFileSelect(selectedVideoFile);
      setFileLoadProgress(MEDIA_LOAD_PHASE.COMPLETE);
      return true;
    } catch (err) {
      console.error('Tauri 文件选择失败:', err);
      return false;
    } finally {
      setIsFileLoading(false);
      setFileLoadProgress(null);
    }
  }, [handleFileSelect]);

  const handleNativeFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Tauri 环境由按钮直接调用原生对话框，此处仅处理浏览器 <input> 选择
    const isTauri = '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      event.target.value = '';
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    setIsFileLoading(true);
    setFileLoadProgress(MEDIA_LOAD_PHASE.START);

    try {
      const objectUrl = URL.createObjectURL(file);
      setFileLoadProgress(MEDIA_LOAD_PHASE.METADATA);

      let duration = 0;
      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        duration = await new Promise<number>((resolve) => {
          const probe = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
          probe.preload = 'metadata';
          probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
          probe.onerror = () => resolve(0);
          probe.src = objectUrl;
        });
      }

      setFileLoadProgress(MEDIA_LOAD_PHASE.FINALIZING);
      const selectedVideoFile: VideoFile = {
        file,
        url: objectUrl,
        duration,
        size: file.size,
        type: file.type,
        name: file.name,
      };

      handleFileSelect(selectedVideoFile);
      setFileLoadProgress(MEDIA_LOAD_PHASE.COMPLETE);
    } finally {
      setIsFileLoading(false);
      setFileLoadProgress(null);
      event.target.value = '';
    }
  }, [handleFileSelect]);

  // 点击上传按钮：Tauri 环境用原生对话框（直接拿文件路径），浏览器环境用 <input>
  const handleUploadClick = useCallback(() => {
    const isTauri = '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      handleTauriFileSelect();
    } else {
      uploadInputRef.current?.click();
    }
  }, [handleTauriFileSelect]);

  const handleUrlLoad = useCallback(async () => {
    const url = urlInput.trim();
    if (!url || isUrlLoading) return;

    setIsUrlLoading(true);
    setUrlLoadProgress(MEDIA_LOAD_PHASE.START);
    try {
      const selectedVideoFile = await loadMediaFromUrl(url, (loaded, total) => {
        setUrlLoadProgress(calcDownloadProgress(loaded, total));
      });
      setUrlLoadProgress(MEDIA_LOAD_PHASE.FINALIZING);
      handleFileSelect(selectedVideoFile);
      setUrlLoadProgress(MEDIA_LOAD_PHASE.COMPLETE);
      setUrlInput('');
    } catch (error) {
      console.error('URL 加载失败:', error);
      const errorMessage = t('messages.fileUpload.urlLoadFailed');
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsUrlLoading(false);
      setUrlLoadProgress(null);
    }
  }, [urlInput, isUrlLoading, handleFileSelect, setError, t]);

  const subtitleExportChunks = useMemo(
    () => chunks.filter((chunk) => !chunk.deleted),
    [chunks],
  );

  // 开始视频处理
  const handleStartProcessing = useCallback(async (options: VideoProcessingOptions) => {
    if (!videoFile) {
      console.error(t('messages.video.videoLoadFailed'));
      return;
    }

    try {
      const segments = buildVideoExportSegments({
        chunks,
        wordChunks,
        hasWordTimestamps,
        duration: timelineDuration,
      });

      await processVideo(videoFile, segments, {
        ...options,
        subtitleChunks: subtitleExportChunks,
      });
    } catch (error) {
      console.error('视频处理失败:', error);
      console.error('App视频处理错误详情:', {
        videoFile: videoFile?.name,
        error
      });
      setError(`${t('messages.export.exportFailed')}: ${error instanceof Error ? error.message : t('common.error')}`);
    }
  }, [
    videoFile,
    chunks,
    wordChunks,
    hasWordTimestamps,
    timelineDuration,
    subtitleExportChunks,
    processVideo,
    setError,
    t,
  ]);

  // 打开视频导出对话框
  const handleOpenVideoExportDialog = useCallback(() => {
    setExportDialogType('video');
    setExportDialogOpen(true);
  }, []);

  // 打开字幕导出对话框
  const handleOpenSubtitleExportDialog = useCallback(() => {
    setExportDialogType('subtitles');
    setExportDialogOpen(true);
  }, []);

  // 智能剪切空白段
  const handleSmartCutBlank = useCallback(() => {
    runSmartCutBlank({
      chunks,
      threshold: smartCutSilenceThreshold,
      totalDuration: videoDuration,
      insertBlankChunks,
      onEmpty: () => toast.info(t('components.workstation.smartCutEmpty')),
      onDone: (result) => {
        toast.success(
          t('components.workstation.smartCutDone')
            .replace('{count}', String(result.segments.length))
            .replace('{seconds}', result.totalBlankSeconds.toFixed(1)),
        );
      },
    });
  }, [chunks, smartCutSilenceThreshold, videoDuration, insertBlankChunks, t]);

  // 处理视频导出配置：先选择保存位置，再开始处理
  const handleVideoExport = useCallback(async (options: VideoExportOptions) => {
    const format = options.format === 'mp4' ? 'mp4' : 'webm';
    const saveTarget = await pickVideoExportSaveTarget(format, videoFile?.name);
    if (!saveTarget) return;

    exportSaveTargetRef.current = saveTarget;

    await handleStartProcessing({
      format,
      quality: options.quality,
      preserveAudio: true,
      subtitleProcessing: options.subtitleProcessing,
      subtitleStyle: subtitleStylePair.primary,
      subtitleStylePair: subtitleStylePair,
      subtitleExportMode: options.subtitleExportMode,
      videoWidth: videoMeta.width,
      videoHeight: videoMeta.height,
      engine: isTauriRuntime() ? 'ffmpeg-tauri' : undefined,
      outputPath: saveTarget.outputPath,
    });
  }, [handleStartProcessing, subtitleStylePair, videoMeta, videoFile?.name]);

  // 监听字幕变化并通知外部
  useEffect(() => {
    onSubtitleChanged?.(activeChunks);
  }, [activeChunks, onSubtitleChanged]);

  return (
    <div
      className={`flycut-caption-wrapper ${effectiveTheme} ${className || ''}`}
      style={style}
      {...otherProps}
    >
      <div className="h-screen bg-background flex flex-col">
        {/* 顶部标题栏 - Aimu 风格 */}
        <header className="flex-shrink-0 h-14 bg-card border-b border-border z-10 flex items-center justify-between px-4">
          {/* LEFT */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <a href="https://www.aimu-app.com/" target="_blank" rel="noreferrer" className="-ml-1 rounded px-1 py-1 hover:text-primary transition-colors">
                <BrandLogo label={t('components.workstation.appName')} />
              </a>
              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-mono">v2.0.0</span>
            </div>
            
            <div className="h-4 w-px bg-border mx-2"></div>
            
            <div className="create-menu relative">
              <button data-testid="create-trigger" className="flex items-center space-x-1.5 text-sm font-medium hover:text-primary transition-colors">
                <Wand2 className="w-4 h-4" />
                <span>{t('components.workstation.create')}</span>
              </button>
              <div data-testid="create-popover" className="create-popover aimu-floating-panel absolute left-0 top-full z-50 mt-4 w-[280px] rounded border p-3 shadow-2xl backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-aimu-text-primary">
                  <Upload className="h-3.5 w-3.5 text-aimu-coral" />
                  <span>{t('components.workstation.create')}</span>
                </div>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/ogg,audio/mp3,audio/wav,audio/ogg,audio/m4a"
                  className="hidden"
                  onChange={handleNativeFileSelect}
                />
                <button
                  onClick={handleUploadClick}
                  disabled={isMediaLoading}
                  className="flex w-full flex-col items-center justify-center rounded border border-dashed border-aimu-border bg-aimu-input px-3 py-4 text-center transition-colors hover:bg-aimu-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFileLoading ? (
                    <>
                      <Loader2 className="mb-2 h-5 w-5 animate-spin text-aimu-text-muted" />
                      <span className="text-xs font-medium text-aimu-text-primary">
                        {t('components.workstation.loadingMedia')}
                        {fileLoadProgress !== null ? ` ${fileLoadProgress}%` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="mb-2 h-5 w-5 text-aimu-text-muted" />
                      <span className="text-xs font-medium text-aimu-text-primary">{t('components.workstation.dropFile')}</span>
                      <span className="mt-1 text-[10px] leading-4 text-aimu-text-muted">{t('components.workstation.supportedFormatsShort')}</span>
                    </>
                  )}
                </button>
                <div className="my-3 flex items-center gap-2">
                  <div className="h-px flex-1 bg-aimu-border" />
                  <span className="text-[10px] text-aimu-text-muted">{t('components.workstation.orDivider')}</span>
                  <div className="h-px flex-1 bg-aimu-border" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-aimu-text-muted" />
                    <input
                      data-testid="create-url-input"
                      type="url"
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleUrlLoad();
                        }
                      }}
                      placeholder={t('components.workstation.urlPlaceholder')}
                      className="h-8 w-full rounded border border-aimu-border bg-aimu-input pl-8 pr-2 text-xs text-aimu-text-primary placeholder:text-aimu-text-muted focus:border-aimu-coral/50 focus:outline-none"
                      disabled={isUrlLoading}
                    />
                  </div>
                  <button
                    type="button"
                    data-testid="create-url-load"
                    onClick={() => void handleUrlLoad()}
                    disabled={!urlInput.trim() || isUrlLoading}
                    className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded border border-aimu-coral/35 bg-aimu-red-bg px-3 text-xs font-medium text-aimu-coral transition-colors hover:bg-aimu-coral/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUrlLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>
                          {t('components.workstation.loadingMedia')}
                          {urlLoadProgress !== null ? ` ${urlLoadProgress}%` : ''}
                        </span>
                      </>
                    ) : (
                      t('components.workstation.loadUrl')
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  data-testid="create-sample-load"
                  onClick={() => void handleLoadSampleVideo()}
                  disabled={isSampleLoading || isUrlLoading}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-aimu-coral/35 bg-aimu-red-bg px-3 py-2 text-xs font-medium text-aimu-coral transition-colors hover:bg-aimu-coral/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSampleLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>
                        {t('components.workstation.loadingSampleVideo')}
                        {sampleLoadProgress !== null ? ` ${sampleLoadProgress}%` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      {t('components.workstation.useSampleVideo')}
                    </>
                  )}
                </button>
              </div>
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center space-x-1.5 text-sm font-medium hover:text-primary transition-colors">
                  <Download className="w-4 h-4" />
                  <span>{t('components.workstation.export')}</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={handleOpenVideoExportDialog}
                  disabled={!videoFile}
                  className="flex items-center gap-2"
                >
                  <Video className="w-4 h-4" />
                  <span>{t('components.workstation.exportVideo')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleOpenSubtitleExportDialog}
                  disabled={chunks.length === 0}
                  className="flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  <span>{t('components.workstation.exportSubtitles')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={handleSmartCutBlank}
              disabled={chunks.length === 0}
              className="flex items-center space-x-1.5 text-sm font-medium hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={t('components.workstation.smartCutBlankTitle')}
            >
              <Wand2 className="w-4 h-4" />
              <span>{t('components.workstation.smartCutBlank')}</span>
            </button>
            
            <div className="h-4 w-px bg-border mx-2"></div>
            
            <div className="flex items-center space-x-3 text-muted-foreground">
              <button className="hover:text-foreground transition-colors"><Undo2 className="w-4 h-4" /></button>
              <button className="hover:text-foreground transition-colors"><Redo2 className="w-4 h-4" /></button>
              <button className="hover:text-foreground transition-colors"><Keyboard className="w-4 h-4" /></button>
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex items-center space-x-3 text-xs">
            <a data-testid="github-link" href="https://github.com/x007xyz/flycut-caption" target="_blank" rel="noreferrer" className="flex items-center space-x-1.5 text-muted-foreground hover:text-foreground transition-colors font-medium px-2">
              <Github className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </a>
            
            <div className="h-4 w-px bg-border mx-1"></div>
            
            {mergedConfig.enableLanguageSelector !== false && (
              <LanguageSelector
                variant="minimal"
                currentLanguage={language}
                languages={languageOptions}
                onLanguageChange={(newLanguage) => {
                  setLanguage(newLanguage);
                  if (onLanguageChange) {
                    onLanguageChange(newLanguage);
                  }
                }}
              />
            )}

            {mergedConfig.enableThemeToggle !== false && (
              <ThemeToggle variant="button" />
            )}
            
            <MessageCenterButton />
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="设置"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 主要内容区域 - Aimu 风格左右分栏 */}
        <div className="flex-1 flex overflow-hidden bg-background">
          <>
              {/* 左侧：视频播放器 + 字幕设置 - 占 50% 宽度 */}
              <div className="w-1/2 flex-shrink-0 flex flex-col border-r border-border bg-background overflow-hidden">
                {/* 视频播放器区域 */}
                <div className="relative flex-1 bg-aimu-input flex items-center justify-center overflow-hidden">
                  {videoFile ? (
                    <div className="w-full h-full">
                      <EnhancedVideoPlayer
                        ref={videoPlayerRef}
                        videoUrl={videoFile.url}
                        className="w-full h-full"
                        onTimeUpdate={(time) => setCurrentTime(time)}
                        primaryStyle={subtitleStylePair.primary}
                        secondaryStyle={subtitleStylePair.secondary}
                        displayMode={display}
                        onPrimaryStyleChange={(s) => setSubtitleStylePair(prev => ({ ...prev, primary: s }))}
                        onVideoDimensionsChange={(dimensions) => {
                          setVideoMeta(dimensions);
                          const preset = inferAspectPreset(dimensions.width, dimensions.height);
                          // aspectPreset 仅作用于 primary（位置/比例共享）
                          setSubtitleStylePair((prev) => (
                            prev.primary.aspectPreset === preset
                              ? prev
                              : { ...prev, primary: applyAspectPreset(prev.primary, preset) }
                          ));
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8">
                      <button
                        onClick={handleUploadClick}
                        disabled={isMediaLoading}
                        className="flex w-full max-w-md flex-col items-center justify-center rounded-lg border border-dashed border-aimu-border bg-aimu-panel px-6 py-10 text-center transition-colors hover:bg-aimu-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isFileLoading ? (
                          <>
                            <Loader2 className="mb-3 h-10 w-10 animate-spin text-aimu-text-muted" />
                            <span className="text-sm font-medium text-aimu-text-primary">
                              {t('components.workstation.loadingMedia')}
                              {fileLoadProgress !== null ? ` ${fileLoadProgress}%` : ''}
                            </span>
                          </>
                        ) : (
                          <>
                            <Upload className="mb-3 h-10 w-10 text-aimu-text-muted" />
                            <span className="text-sm font-medium text-aimu-text-primary">
                              {t('components.workstation.dropFile')}
                            </span>
                            <span className="mt-1 text-[11px] text-aimu-text-muted">
                              {t('components.workstation.supportedFormatsShort')}
                            </span>
                          </>
                        )}
                      </button>
                      <div className="flex items-center gap-2 text-[11px] text-aimu-text-muted">
                        <span>{t('components.workstation.orDivider')}</span>
                      </div>
                      <button
                        onClick={() => void handleLoadSampleVideo()}
                        disabled={isSampleLoading}
                        className="flex items-center gap-2 rounded-md border border-aimu-coral/35 bg-aimu-red-bg px-4 py-2 text-sm font-medium text-aimu-coral transition-colors hover:bg-aimu-coral/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSampleLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>
                              {t('components.workstation.loadingSampleVideo')}
                              {sampleLoadProgress !== null ? ` ${sampleLoadProgress}%` : ''}
                            </span>
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            {t('components.workstation.useSampleVideo')}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* 视频下方：字幕设置与待办事项（Tabs 切换） */}
                <div className="h-60 border-t border-border bg-card flex flex-col overflow-hidden">
                  {/* Tab 头部 */}
                  <div className="flex border-b border-border bg-muted/10 px-4">
                    {tabOptions.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          'px-4 py-2 text-xs font-medium transition-colors',
                          activeTab === tab.id
                            ? 'bg-aimu-purple text-white'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab 内容 */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'style' ? (
                      <div className="flex flex-col h-full">
                        <SubtitleSettings
                          stylePair={subtitleStylePair}
                          onStylePairChange={setSubtitleStylePair}
                          displayMode={display}
                          onDisplayModeChange={setDisplay}
                        />
                      </div>
                    ) : activeTab === 'tools' ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground font-medium mb-2">
                          {t('components.workstation.plannedTools')}
                        </div>
                        {renderFeatureItems(plannedFeatures.tools)}
                      </div>
                    ) : activeTab === 'options' ? (
                      <ASRSettingsPanel onOpenSettings={() => setSettingsOpen(true)} />
                    ) : (
                      <AISettingsPanel />
                    )}
                  </div>
                </div>
              </div>

              {/* 右侧：字幕编辑器 (SubtitleEditorPanel) - 占 50% 宽度 */}
              <div className="flex-1 flex flex-col bg-background overflow-hidden">
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 overflow-hidden">
                    <SubtitleEditorPanel
                      videoPlayerRef={videoPlayerRef}
                      isASRLoading={isASRLoading}
                      asrProgress={asrProgress}
                    />
                  </div>
                </div>
              </div>
          </>
        </div>

        <TimelineWaveform
          currentTime={currentTime}
          duration={timelineDuration}
          chunks={chunks}
          onSeek={handleTimelineSeek}
          isASRLoading={isASRLoading}
          asrProgress={asrProgress}
          isVideoProcessing={isProcessing}
          videoProgress={videoProgress}
          mediaWaveformPeaks={mediaWaveformPeaks}
        />

        {/* 底部状态栏 - Aimu 风格 */}
        <footer className="flex-shrink-0 h-7 border-t border-border bg-background px-4 flex items-center justify-between text-[11px] text-muted-foreground select-none">
          <div className="flex items-center">
            {t('components.workstation.tip')}
          </div>
          <div className="flex items-center gap-3 font-mono">
            <div>{t('components.workstation.used')}: {memory.used}</div>
            <div className="text-border">|</div>
            <div>{t('components.workstation.allocated')}: {memory.allocated}</div>
            <div className="text-border">|</div>
            <div>{t('components.workstation.limit')}: {memory.limit}</div>
          </div>
        </footer>

        {/* 导出配置对话框 */}
        <ExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          exportType={exportDialogType}
          defaultExportMode={display}
          onExportSubtitles={(format, mode) => handleExportSubtitles(format, mode)}
          onExportVideo={handleVideoExport}
        />

        {/* 设置对话框（模型下载） */}
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </div>
  );
}

const FlyCutCaption: React.FC<FlyCutCaptionProps> = (props) => {
  return (
    <LocaleProvider
      language={props.config?.language || 'en'}
      locale={props.locale}
      onLanguageChange={props.onLanguageChange}
    >
      <ThemeInitializer />
      <FlyCutCaptionContent {...props} />
      <ToastContainer />
    </LocaleProvider>
  );
};

// Add display name for better debugging
FlyCutCaption.displayName = 'FlyCutCaption'

export default FlyCutCaption;
