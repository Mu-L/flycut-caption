// FlyCut Caption - 智能视频字幕裁剪工具

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useChunks, useSetTranscript, useHistoryStore } from '@/stores/historyStore';
import { useThemeStore } from '@/stores/themeStore';
import { useHotkeys } from '@/hooks/useHotkeys';
import { LocaleProvider, useTranslation, useLocale } from '@/contexts/LocaleProvider';
import { EnhancedVideoPlayer } from '@/components/VideoPlayer/EnhancedVideoPlayer';
import type { EnhancedVideoPlayerRef } from '@/components/VideoPlayer/EnhancedVideoPlayer';
import { SubtitleList } from '@/components/SubtitleEditor/SubtitleList';
import { useASR } from '@/hooks/useASR';
import { ASRSettingsPanel } from '@/components/ProcessingPanel/ASRSettingsPanel';
import { AISettingsPanel } from '@/components/AISettingsPanel';
import { SettingsDialog } from '@/components/ProcessingPanel/SettingsDialog';
import { ExportDialog, type VideoExportOptions } from '@/components/ExportPanel/ExportDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import { ToastContainer, MessageCenterButton } from '@/components/MessageCenter';
import { LanguageSelector } from '@/components/LanguageSelector';
import { SubtitleSettings, defaultSubtitleStyle } from '@/components/SubtitleSettings';
import type { SubtitleStyle } from '@/components/SubtitleSettings';
import { cn } from '@/lib/utils';
import {
  useStartVideoProcessing,
  useUpdateVideoProcessingProgress,
  useCompleteVideoProcessing,
  useErrorVideoProcessing
} from '@/stores/messageStore';
import { UnifiedVideoProcessor } from '@/services/UnifiedVideoProcessor';
import { saveFile } from '@/utils/createFileWriter';
import { AudioWaveform, Download, Github, Maximize2, Mic2, Play, Redo2, Scissors, Upload, Wand2, Keyboard, Undo2, ZoomIn, ZoomOut, Settings, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SubtitleChunk } from '@/types/subtitle';
import type { VideoFile, VideoSegment, VideoProcessingProgress } from '@/types/video';
import type { VideoProcessingOptions, VideoEngineType } from '@/types/videoEngine';
import type { FlyCutCaptionProps } from './types';
import { defaultConfig } from './types';

type AimuTab = 'style' | 'tools' | 'options' | 'api';
type ShadowSize = 'N' | 'S' | 'M' | 'L';
type DisplayMode = 'Bilingual' | 'Main' | 'Second';

interface BrowserPerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const mockTranscript = {
  language: 'zh',
  duration: 44.8,
  text: 'Aimu 风格字幕编辑演示',
  chunks: [
    {
      id: 'mock-1',
      text: '今天我们把一段口播快速整理成适合发布的双语字幕。',
      secondText: 'Today we turn a spoken clip into bilingual captions ready to publish.',
      timestamp: [0.2, 4.8] as [number, number],
    },
    {
      id: 'mock-2',
      text: '先识别音频，再在时间轴上微调每一句的起止点。',
      secondText: 'First transcribe the audio, then tune every sentence on the timeline.',
      timestamp: [5.2, 9.6] as [number, number],
    },
    {
      id: 'mock-3',
      text: '删除停顿和口误后，预览模式会自动跳过被裁掉的片段。',
      secondText: 'After removing pauses and mistakes, preview mode skips the cut segments.',
      timestamp: [10.4, 15.7] as [number, number],
    },
    {
      id: 'mock-4',
      text: '字幕样式可以直接同步到左侧视频预览。',
      secondText: 'Caption styling syncs directly to the video preview on the left.',
      timestamp: [16.3, 20.8] as [number, number],
    },
    {
      id: 'mock-5',
      text: '底部波形用来快速定位声音峰值和空白区间。',
      secondText: 'The waveform below helps locate peaks and silent gaps quickly.',
      timestamp: [21.7, 26.1] as [number, number],
    },
    {
      id: 'mock-6',
      text: '最后导出 SRT、JSON，或者把字幕直接烧录进视频。',
      secondText: 'Finally export SRT, JSON, or burn the captions into the video.',
      timestamp: [27.2, 32.4] as [number, number],
    },
  ],
};

const waveformBars = Array.from({ length: 168 }, (_, index) => {
  const signal = Math.sin(index * 0.43) * 0.38 + Math.sin(index * 0.13 + 1.4) * 0.28;
  const pulse = index % 17 === 0 ? 0.28 : 0;
  return Math.max(14, Math.min(86, Math.round(44 + signal * 58 + pulse * 100)));
});

const formatTimelineTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

function MockVideoPreview({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div data-testid="mock-video-preview" className={cn('mock-video-preview relative h-full w-full overflow-hidden', className)}>
      <div className="mock-video-preview-bg absolute inset-0" />
      <div className="mock-video-frame absolute inset-x-[12%] top-[12%] aspect-video rounded border shadow-2xl">
        <div className="mock-video-grid absolute inset-0 bg-[size:42px_42px] opacity-55" />
        <div className="mock-video-badge absolute left-6 top-5 flex items-center gap-2 rounded px-2 py-1 text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full bg-aimu-coral" />
          {t('components.workstation.mockPreview')}
        </div>
        <div className="absolute inset-x-8 bottom-12 text-center">
          <div className="mock-subtitle-primary mx-auto inline-block max-w-[82%] rounded px-4 py-2 text-[22px] font-semibold leading-snug shadow-lg">
            {t('components.workstation.mockSubtitlePrimary')}
          </div>
          <div className="mock-subtitle-secondary mx-auto mt-2 inline-block max-w-[82%] rounded px-3 py-1.5 text-sm">
            {t('components.workstation.mockSubtitleSecondary')}
          </div>
        </div>
        <button className="mock-play-button absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full backdrop-blur">
          <Play className="h-7 w-7 fill-current" />
        </button>
      </div>
      <div className="mock-video-meta absolute bottom-4 left-4 right-4 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <Mic2 className="h-3.5 w-3.5 text-aimu-coral" />
          <span>{t('components.workstation.mockFileName')}</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span>00:21.7</span>
          <span>/</span>
          <span>00:44.8</span>
        </div>
      </div>
    </div>
  );
}

function TimelineWaveform({
  currentTime,
  duration,
  chunks,
  onSeek,
  isASRLoading,
  asrProgress,
}: {
  currentTime: number;
  duration: number;
  chunks: Array<Pick<SubtitleChunk, 'id' | 'timestamp' | 'deleted' | 'text' | 'secondText'>>;
  onSeek?: (time: number) => void;
  /** ASR 是否正在识别 */
  isASRLoading?: boolean;
  /** ASR 进度信息 */
  asrProgress?: import('@/types/subtitle').ASRProgress | null;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const safeDuration = Math.max(duration, 1);
  
  // 基础像素密度：每秒50px，缩放会改变这个值
  const basePixelsPerSecond = 50;
  const pixelsPerSecond = basePixelsPerSecond * zoom;
  
  // 时间轴总宽度（像素）
  const timelineWidth = safeDuration * pixelsPerSecond;
  
  // 播放头位置（像素）
  const playheadPosition = currentTime * pixelsPerSecond;
  
  const minZoom = 0.5;
  const maxZoom = 8;
  const zoomPercent = Math.round(zoom * 100);
  
  // 计算刻度：基于像素位置而非百分比
  // 每秒一个刻度，每5秒显示标签
  const rulerTicks = useMemo(() => {
    const ticks: Array<{ time: number; leftPx: number; major: boolean; label: string }> = [];
    const tickCount = Math.ceil(safeDuration);
    for (let second = 0; second <= tickCount; second++) {
      ticks.push({
        time: second,
        leftPx: second * pixelsPerSecond,
        major: second % 5 === 0,
        label: formatTimelineTime(second),
      });
    }
    return ticks;
  }, [safeDuration, pixelsPerSecond]);

  const handleZoomOut = useCallback(() => {
    setZoom((currentZoom) => Math.max(minZoom, Number((currentZoom / 1.5).toFixed(2))));
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((currentZoom) => Math.min(maxZoom, Number((currentZoom * 1.5).toFixed(2))));
  }, []);

  const handleFitTimeline = useCallback(() => {
    setZoom(1);
    viewportRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, []);

  const handleTimelineClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - bounds.left;
    const clickTime = clickX / pixelsPerSecond;
    onSeek(Math.max(0, Math.min(safeDuration, clickTime)));
  }, [onSeek, safeDuration, pixelsPerSecond]);

  // 自动滚动使播放头保持可见
  useEffect(() => {
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
  }, [playheadPosition]);

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
          ) : (
            <span className="font-mono text-[11px] text-aimu-text-muted">{formatTimelineTime(currentTime)} / {formatTimelineTime(safeDuration)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-aimu-text-muted">
          <button className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary" title={t('components.workstation.cut')}>
            <Scissors className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= minZoom}
            className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={t('components.subtitleEditor.zoomOut')}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-[10px] tabular-nums text-aimu-text-secondary">
            {zoomPercent}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= maxZoom}
            className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={t('components.subtitleEditor.zoomIn')}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitTimeline}
            disabled={zoom === 1}
            className="rounded p-1 hover:bg-aimu-hover hover:text-aimu-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={t('components.workstation.fit')}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="h-[100px] px-3 py-2">
        <div ref={viewportRef} className="h-full overflow-x-auto overflow-y-hidden">
          <div className="relative h-full" style={{ width: `${timelineWidth}px`, minWidth: '100%' }}>
            <div
              data-testid="timeline-ruler"
              className="timeline-ruler absolute left-0 right-0 top-0 h-6 cursor-pointer overflow-hidden rounded border border-aimu-border bg-aimu-input"
              onClick={handleTimelineClick}
            >
              {rulerTicks.map((tick) => (
                <div
                  key={tick.time}
                  className={cn(
                    'absolute bottom-0 w-px -translate-x-px',
                    tick.major ? 'h-4 bg-aimu-text-primary' : 'h-2 bg-aimu-text-muted/70'
                  )}
                  style={{ left: `${tick.leftPx}px` }}
                >
                  {tick.major && (
                    <span className="absolute left-1 top-0 whitespace-nowrap font-mono text-[10px] leading-none text-aimu-text-secondary">
                      {tick.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div
              className="absolute bottom-1 left-0 right-0 top-8 cursor-pointer rounded border border-aimu-border bg-aimu-input"
              onClick={handleTimelineClick}
            >
              <div className="absolute inset-x-0 top-1/2 h-px bg-aimu-border-light" />
              <div className="absolute inset-0 flex items-center gap-[2px] px-2">
                {waveformBars.map((height, index) => (
                  <span
                    key={index}
                    className="flex-1 rounded-full bg-aimu-coral/65"
                    style={{ height: `${height}%`, opacity: index % 5 === 0 ? 0.95 : 0.62 }}
                  />
                ))}
              </div>
              {chunks.map((chunk) => {
                const leftPx = chunk.timestamp[0] * pixelsPerSecond;
                const widthPx = (chunk.timestamp[1] - chunk.timestamp[0]) * pixelsPerSecond;
                const label = [chunk.text, chunk.secondText].filter(Boolean).join(' / ');
                return (
                  <div
                    key={chunk.id}
                    className={cn(
                      'absolute bottom-1 top-1 flex cursor-pointer items-center overflow-hidden rounded-sm border px-1.5 shadow-sm',
                      chunk.deleted
                        ? 'border-aimu-coral/45 bg-aimu-coral/18'
                        : 'border-aimu-purple/65 bg-aimu-purple/30'
                    )}
                    style={{ left: `${leftPx}px`, width: `${Math.max(widthPx, 32)}px` }}
                    title={label}
                  >
                    <span
                      className={cn(
                        'min-w-0 truncate text-[10px] font-medium leading-none opacity-75',
                        chunk.deleted
                          ? 'text-aimu-coral line-through decoration-aimu-coral'
                          : 'text-aimu-text-primary'
                      )}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
              <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-white shadow-[0_0_0_1px_rgba(245,108,108,0.65)]" style={{ left: `${playheadPosition}px` }}>
                <div className="absolute -left-1.5 -top-1 h-3 w-3 rounded-full bg-aimu-coral" />
              </div>
              {isASRLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-aimu-panel/70 backdrop-blur-[1px]">
                  <div className="flex items-center gap-2 rounded-full border border-aimu-border bg-aimu-panel px-3 py-1 text-[11px] text-aimu-coral shadow-sm">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="font-medium">{asrProgress?.data || t('messages.asr.asrStarted')}</span>
                    {asrProgress?.progress !== undefined && (
                      <span className="font-mono text-aimu-text-muted">· {Math.round(asrProgress.progress)}%</span>
                    )}
                  </div>
                </div>
              )}
            </div>
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
  const shadow = useAppStore(state => state.shadow);
  const font = useAppStore(state => state.font);
  const display = useAppStore(state => state.display);
  const setShadow = useAppStore(state => state.setShadow);
  const setFont = useAppStore(state => state.setFont);
  const setDisplay = useAppStore(state => state.setDisplay);
  const chunks = useChunks();
  const setTranscript = useSetTranscript();

  // 内存使用情况状态 (Aimu 风格)
  const [memory, setMemory] = useState({ used: '42.63 MB', allocated: '54.17 MB', limit: '3.5 GB' });

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

  useEffect(() => {
    // 仅在无视频文件时填充演示字幕，避免与真实 ASR 流程冲突
    if (chunks.length === 0 && !useAppStore.getState().videoFile) {
      setTranscript(mockTranscript);
      useAppStore.getState().setStage('edit');
    }
  }, [chunks.length, setTranscript]);

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
  const [currentProcessingMessageId, setCurrentProcessingMessageId] = useState<string | null>(null);
  const [currentEngine, setCurrentEngine] = useState<VideoEngineType | null>(null);
  const processorRef = useRef<UnifiedVideoProcessor | null>(null);

  // 导出对话框状态
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogType, setExportDialogType] = useState<'subtitles' | 'video'>('video');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 字幕样式状态
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(defaultSubtitleStyle);

  // 视频播放器引用
  const videoPlayerRef = useRef<EnhancedVideoPlayerRef>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const timelineDuration = useMemo(() => {
    const chunkEndTime = chunks.reduce((maxTime, chunk) => Math.max(maxTime, chunk.timestamp[1]), 0);
    return Math.max(videoFile?.duration || 0, chunkEndTime, mockTranscript.duration);
  }, [chunks, videoFile?.duration]);

  const handleTimelineSeek = useCallback((time: number) => {
    const nextTime = Math.max(0, Math.min(timelineDuration, time));
    setCurrentTime(nextTime);
    videoPlayerRef.current?.seekTo(nextTime);
  }, [setCurrentTime, timelineDuration]);


  // const availableEngines = UnifiedVideoProcessor.getSupportedEngines();

  const handleProgress = useCallback((progressData: VideoProcessingProgress) => {
    if (currentProcessingMessageId) {
      updateVideoProcessingProgress(currentProcessingMessageId, progressData);
    }
    onProgress?.(progressData.stage, progressData.progress);
  }, [currentProcessingMessageId, updateVideoProcessingProgress, onProgress]);

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

      // 开始视频处理消息
      messageId = startVideoProcessing(t('messages.fileUpload.processingFile'));
      setCurrentProcessingMessageId(messageId);

      // 创建处理器（如果不存在）
      if (!processorRef.current) {
        processorRef.current = new UnifiedVideoProcessor(handleProgress);
      }

      // 初始化处理器（如果还没有初始化或需要切换引擎）
      const engineType = await processorRef.current.initialize(
        videoFile,
        options?.engine || currentEngine || undefined
      );
      setCurrentEngine(engineType);

      // 处理视频
      const resultBlob = await processorRef.current.processVideo(segments, options || {
        quality: 'medium',
        preserveAudio: true
      });

      // 完成处理
      if (messageId) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
        const filename = `cut_video_${timestamp}.${options?.format || 'mp4'}`;
        completeVideoProcessing(messageId, resultBlob, filename);
        onVideoProcessed?.(resultBlob, filename);
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
      setCurrentProcessingMessageId(null);
    }
  }, [isProcessing, currentEngine, startVideoProcessing, completeVideoProcessing, errorVideoProcessing, handleProgress, onVideoProcessed, onError, t]);


  // 格式化时间为 SRT 格式
  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }, []);


  // 导出字幕
  const handleExportSubtitles = useCallback(async (format: 'srt' | 'json') => {
    const keptChunks = chunks.filter(chunk => !chunk.deleted);
    if (keptChunks.length === 0) {
      console.warn(t('messages.subtitle.emptySubtitleText'));
      return;
    }

    let content: string;
    let filename: string;
    let types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;

    if (format === 'srt') {
      content = keptChunks.map((chunk, index) => {
        const start = formatTime(chunk.timestamp[0]);
        const end = formatTime(chunk.timestamp[1]);
        return `${index + 1}\n${start} --> ${end}\n${chunk.text}\n`;
      }).join('\n');
      filename = `subtitles_${Date.now()}.srt`;
      types = [{
        description: 'SRT Subtitle files',
        accept: { 'text/srt': ['.srt'] },
      }];
    } else {
      content = JSON.stringify(keptChunks.map(chunk => ({
        text: chunk.text,
        timestamp: chunk.timestamp,
      })), null, 2);
      filename = `subtitles_${Date.now()}.json`;
      types = [{
        description: 'JSON files',
        accept: { 'application/json': ['.json'] },
      }];
    }

    const blob = new Blob([content], { type: 'text/plain' });
    await saveFile(blob, filename, types);
    onExportComplete?.(blob, filename);
  }, [chunks, formatTime, onExportComplete, t]);

  // 重新上传文件
  const handleReupload = useCallback(() => {
    const setVideoFile = useAppStore.getState().setVideoFile;
    setVideoFile(null);
  }, []);


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

  // Tauri 环境下通过原生文件选择器选择本地文件，拿到本地路径
  const handleTauriFileSelect = useCallback(async () => {
    const isTauri = '__TAURI_INTERNALS__' in window;
    if (!isTauri) return false;

    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
      const filePath = await invoke<string | null>('pick_media_file');
      if (!filePath) return true; // 用户取消

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

      handleFileSelect(selectedVideoFile);
      return true;
    } catch (err) {
      console.error('Tauri 文件选择失败:', err);
      return false;
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

    const selectedVideoFile: VideoFile = {
      file,
      url: URL.createObjectURL(file),
      duration: 0,
      size: file.size,
      type: file.type,
      name: file.name,
    };

    handleFileSelect(selectedVideoFile);
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

  // 从字幕生成视频片段 - 包含所有片段的删除状态和字幕信息
  const videoSegments = useMemo((): VideoSegment[] => {
    return chunks.map(chunk => ({
      start: chunk.timestamp[0],
      end: chunk.timestamp[1],
      keep: !chunk.deleted,
      text: chunk.text,
      id: chunk.id
    }));
  }, [chunks]);

  // 开始视频处理
  const handleStartProcessing = useCallback(async (options: VideoProcessingOptions) => {
    if (!videoFile) {
      console.error(t('messages.video.videoLoadFailed'));
      return;
    }

    try {
      await processVideo(videoFile, videoSegments, options);
    } catch (error) {
      console.error('视频处理失败:', error);
      console.error('App视频处理错误详情:', {
        videoFile: videoFile?.name,
        segments: videoSegments?.length,
        error
      });
      setError(`${t('messages.export.exportFailed')}: ${error instanceof Error ? error.message : t('common.error')}`);
    }
  }, [videoFile, videoSegments, processVideo, setError, t]);

  // 打开视频导出对话框
  const handleOpenVideoExportDialog = useCallback(() => {
    setExportDialogType('video');
    setExportDialogOpen(true);
  }, []);

  // 处理视频导出配置
  const handleVideoExport = useCallback(async (options: VideoExportOptions) => {
    await handleStartProcessing({
      format: options.format === 'mp4' ? 'mp4' : 'webm',
      quality: options.quality,
      preserveAudio: true,
      subtitleProcessing: options.subtitleProcessing,
      subtitleStyle: subtitleStyle, // 传递字幕样式配置
    });
  }, [handleStartProcessing, subtitleStyle]);

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
              <a href="https://www.aimu-app.com/" target="_blank" rel="noreferrer" className="text-lg font-bold tracking-tight hover:text-primary transition-colors">
                {t('components.workstation.appName')}
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
                  className="flex w-full flex-col items-center justify-center rounded border border-dashed border-aimu-border bg-aimu-input px-3 py-4 text-center transition-colors hover:bg-aimu-hover"
                >
                  <Upload className="mb-2 h-5 w-5 text-aimu-text-muted" />
                  <span className="text-xs font-medium text-aimu-text-primary">{t('components.workstation.dropFile')}</span>
                  <span className="mt-1 text-[10px] leading-4 text-aimu-text-muted">{t('components.workstation.supportedFormatsShort')}</span>
                </button>
                <button
                  type="button"
                  className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded border border-aimu-coral/35 bg-aimu-red-bg text-xs font-medium text-aimu-coral hover:bg-aimu-coral/15"
                  onClick={handleReupload}
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('components.workstation.useMockTimeline')}
                </button>
              </div>
            </div>
            
            <button onClick={handleOpenVideoExportDialog} className="flex items-center space-x-1.5 text-sm font-medium hover:text-primary transition-colors">
              <Download className="w-4 h-4" />
              <span>{t('components.workstation.export')}</span>
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
                        subtitleStyle={subtitleStyle}
                        onSubtitleStyleChange={setSubtitleStyle}
                      />
                    </div>
                  ) : (
                    <MockVideoPreview />
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
                      <div className="flex flex-col h-full space-y-4">
                        {/* Shadow and Font selectors */}
                        <div className="flex items-center space-x-6 text-sm">
                          <div className="flex items-center space-x-2">
                            <span className="text-muted-foreground font-medium">{t('components.workstation.shadow')}:</span>
                            <Select value={shadow} onValueChange={(val) => setShadow(val as ShadowSize)}>
                              <SelectTrigger className="h-8 w-16 bg-background">
                                <SelectValue placeholder="N" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="N">N</SelectItem>
                                <SelectItem value="S">S</SelectItem>
                                <SelectItem value="M">M</SelectItem>
                                <SelectItem value="L">L</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-center space-x-2">
                            <span className="text-muted-foreground font-medium">{t('components.workstation.font')}:</span>
                            <Select value={font} onValueChange={(val) => setFont(val)}>
                              <SelectTrigger className="h-8 w-56 bg-background">
                                <SelectValue placeholder="Source Han Sans CN (Normal)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Source Han Sans CN (Normal)">Source Han Sans CN (Normal)</SelectItem>
                                <SelectItem value="Arial">Arial</SelectItem>
                                <SelectItem value="Georgia">Georgia</SelectItem>
                                <SelectItem value="Courier New">Courier New</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        
                        <SubtitleSettings
                          style={subtitleStyle}
                          onStyleChange={setSubtitleStyle}
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

              {/* 右侧：字幕编辑器 (SubtitleList) - 占 50% 宽度 */}
              <div className="flex-1 flex flex-col bg-background overflow-hidden">
                {/* Subtitle list editor header */}
                <div className="flex-shrink-0 p-2 border-b border-border bg-card flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-muted-foreground font-medium">{t('components.workstation.display')}:</span>
                      <Select value={display} onValueChange={(val) => setDisplay(val as DisplayMode)}>
                        <SelectTrigger className="h-7 w-28 text-xs bg-background">
                          <SelectValue placeholder={t('components.workstation.displayBilingual')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Bilingual">{t('components.workstation.displayBilingual')}</SelectItem>
                          <SelectItem value="Main">{t('components.workstation.displayMain')}</SelectItem>
                          <SelectItem value="Second">{t('components.workstation.displaySecond')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-muted-foreground font-medium">{t('components.workstation.translate')}:</span>
                      <Select defaultValue="none">
                        <SelectTrigger className="h-7 w-28 text-xs bg-background">
                          <SelectValue placeholder={t('components.workstation.none')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('components.workstation.none')}</SelectItem>
                          <SelectItem value="en">{t('components.languageSelector.english')}</SelectItem>
                          <SelectItem value="zh">{t('components.languageSelector.chinese')}</SelectItem>
                          <SelectItem value="ja">{t('components.languageSelector.japanese')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <button className="flex items-center space-x-1.5 px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 transition-opacity">
                    <Play className="w-3.5 h-3.5" />
                    <span>{t('components.workstation.start')}</span>
                  </button>
                </div>

                {/* Subtitle list */}
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 overflow-hidden">
                    <SubtitleList
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
          onExportSubtitles={handleExportSubtitles}
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
