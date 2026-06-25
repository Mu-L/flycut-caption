// 模型下载面板组件
// 显示所有 ASR 模型（FunASR + Whisper），支持手动下载

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Download, CheckCircle2, Loader2, AlertCircle, Package, SkipForward, Zap } from 'lucide-react';
import type { AvailableModel, ModelDownloadProgress, AllModelsStatus } from '@/types/model';
import type { ASRProgress } from '@/types/subtitle';
import { useAppStore } from '@/stores/appStore';
import { asrService } from '@/services/asrService';

// Whisper 模型信息
const WHISPER_MODEL = {
  id: 'whisper-small',
  name: 'Whisper Small (onnx)',
  description: '多语种支持，浏览器本地运行',
  sizeWebGPU: 196_000_000,
  sizeWASM: 77_000_000,
};

interface ModelDownloadPanelProps {
  className?: string;
}

// 下载类型：'funasr' | 'whisper' | null
type DownloadType = 'funasr' | 'whisper' | null;

export function ModelDownloadPanel({ className }: ModelDownloadPanelProps) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [status, setStatus] = useState<AllModelsStatus | null>(null);
  const [downloadingType, setDownloadingType] = useState<DownloadType>(null);
  const [funasrProgress, setFunasrProgress] = useState<ModelDownloadProgress | null>(null);
  const [whisperProgress, setWhisperProgress] = useState<ASRProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTauri, setIsTauri] = useState(false);
  const [whisperReady, setWhisperReady] = useState(false);

  const deviceType = useAppStore((s) => s.deviceType);

  useEffect(() => {
    setIsTauri('__TAURI_INTERNALS__' in window);
    setWhisperReady(asrService.isWhisperReady());
  }, []);

  // 加载 FunASR 模型列表和状态
  const loadStatus = useCallback(async () => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke<AvailableModel[]>('list_available_models');
      setModels(list);
      const allStatus = await invoke<AllModelsStatus>('check_all_models_downloaded');
      setStatus(allStatus);
    } catch (err) {
      console.error('Failed to load models:', err);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // 监听 FunASR 下载进度
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<ModelDownloadProgress>('model-download-progress', (event) => {
        const p = event.payload;
        setFunasrProgress(p);
        if (p.status === 'complete') {
          setDownloadingType(null);
          setError(null);
          loadStatus();
        }
        if (p.status === 'error') {
          setDownloadingType(null);
          setError(p.error || '下载失败');
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [isTauri, loadStatus]);

  // 下载 FunASR 全部模型
  const startDownloadFunASR = useCallback(async () => {
    setDownloadingType('funasr');
    setFunasrProgress(null);
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<AllModelsStatus>('download_all_models');
    } catch (err) {
      setDownloadingType(null);
      const message = typeof err === 'string' ? err
        : err instanceof Error ? err.message
        : String((err as Record<string, unknown>).message || err);
      console.error('[ModelDownload] FunASR download failed:', err);
      setError(message);
    }
  }, []);

  // 下载 Whisper 模型
  const startDownloadWhisper = useCallback(async () => {
    setDownloadingType('whisper');
    setWhisperProgress(null);
    setError(null);

    // 设置进度回调
    asrService.setWhisperProgressCallback((progress) => {
      setWhisperProgress(progress);
      if (progress.status === 'loaded') {
        setDownloadingType(null);
        setWhisperReady(true);
      }
      if (progress.status === 'error') {
        setDownloadingType(null);
        setError(progress.error || 'Whisper 模型下载失败');
      }
    });

    try {
      await asrService.preloadWhisperModel(deviceType);
    } catch (err) {
      setDownloadingType(null);
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ModelDownload] Whisper download failed:', err);
      setError(message);
    }
  }, [deviceType]);

  const formatSize = (bytes: number) => {
    if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const whisperSize = deviceType === 'webgpu' ? WHISPER_MODEL.sizeWebGPU : WHISPER_MODEL.sizeWASM;
  const funasrAllDownloaded = status?.all_downloaded ?? false;
  const funasrDownloadedCount = status?.downloaded_count ?? 0;
  const funasrTotalModels = status?.total_models ?? models.length;

  // Whisper 下载进度百分比
  const whisperPct = whisperProgress?.progress ?? 0;

  // 模型卡片渲染辅助
  const renderDownloadButton = (
    isReady: boolean,
    isDownloading: boolean,
    onClick: () => void,
  ) => (
    <button
      onClick={onClick}
      disabled={isDownloading || isReady}
      className={cn(
        'flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium shrink-0 transition-colors',
        isReady
          ? 'bg-green-100 text-green-700 cursor-default dark:bg-green-900/30 dark:text-green-400'
          : isDownloading
            ? 'bg-muted text-muted-foreground cursor-wait'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
      )}
    >
      {isDownloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isReady ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      <span>{isDownloading ? '下载中' : isReady ? '已就绪' : '下载'}</span>
    </button>
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* ===== Whisper 模型 ===== */}
      <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
        <div className="flex items-center space-x-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-medium">Whisper 浏览器模型</h4>
        </div>

        <div className="flex items-center justify-between p-3 border rounded-md bg-background">
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium truncate">{WHISPER_MODEL.name}</span>
              {whisperReady && (
                <span className="text-xs text-green-600 flex items-center shrink-0">
                  <CheckCircle2 className="h-3 w-3 mr-0.5" />
                  已下载
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{WHISPER_MODEL.description}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              大小: {formatSize(whisperSize)} ({deviceType === 'webgpu' ? 'WebGPU' : 'WASM'})
            </p>
          </div>
          {renderDownloadButton(whisperReady, downloadingType === 'whisper', startDownloadWhisper)}
        </div>

        {/* Whisper 下载进度条 */}
        {downloadingType === 'whisper' && whisperProgress && (
          <div className="space-y-2 p-3 border rounded-md bg-background">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground truncate max-w-[70%]">
                {whisperProgress.data || whisperProgress.file || '下载中...'}
              </span>
              {whisperProgress.progress !== undefined && (
                <span className="font-medium tabular-nums">{Math.round(whisperPct)}%</span>
              )}
            </div>
            {whisperProgress.progress !== undefined && (
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${whisperPct}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== FunASR 模型 ===== */}
      {isTauri ? (
        <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
          <div className="flex items-center space-x-2">
            <Package className="h-4 w-4" />
            <h4 className="text-sm font-medium">FunASR 桌面端模型</h4>
          </div>

          {models.map((model) => {
            const isDownloaded = status?.downloaded_model_ids.includes(model.id);
            return (
              <div
                key={model.id}
                className={cn(
                  'flex items-center justify-between p-3 border rounded-md bg-background',
                  isDownloaded && 'border-green-300 bg-green-50 dark:bg-green-950/20',
                )}
              >
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium truncate">{model.name}</span>
                    {isDownloaded && (
                      <span className="text-xs text-green-600 flex items-center shrink-0">
                        <CheckCircle2 className="h-3 w-3 mr-0.5" />
                        已下载
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">大小: {formatSize(model.size_bytes)}</p>
                </div>
              </div>
            );
          })}

          {/* FunASR 下载进度条 */}
          {downloadingType === 'funasr' && funasrProgress && (
            <div className="space-y-2 p-3 border rounded-md bg-background">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[70%]">
                  {funasrProgress.status === 'skipped' ? (
                    <span className="flex items-center gap-1">
                      <SkipForward className="h-3 w-3 text-blue-500" />
                      <span className="text-blue-600 dark:text-blue-400">已存在，跳过</span>
                    </span>
                  ) : (
                    funasrProgress.current_file
                  )}
                </span>
                <span className="font-medium tabular-nums">
                  {funasrProgress.total_bytes > 0
                    ? Math.round((funasrProgress.downloaded_bytes / funasrProgress.total_bytes) * 100)
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={cn(
                    'h-2 rounded-full transition-all duration-300',
                    funasrProgress.status === 'skipped' ? 'bg-blue-500' : 'bg-primary',
                  )}
                  style={{
                    width: `${funasrProgress.total_bytes > 0
                      ? Math.round((funasrProgress.downloaded_bytes / funasrProgress.total_bytes) * 100)
                      : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatSize(funasrProgress.downloaded_bytes)} / {formatSize(funasrProgress.total_bytes)}
              </p>
            </div>
          )}

          {/* FunASR 一键下载 */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t">
            <div className="text-xs text-muted-foreground">
              {funasrAllDownloaded ? (
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  FunASR 全部已就绪
                </span>
              ) : (
                <span>
                  FunASR: 已下载 {funasrDownloadedCount}/{funasrTotalModels}
                </span>
              )}
            </div>
            {renderDownloadButton(funasrAllDownloaded, downloadingType === 'funasr', startDownloadFunASR)}
          </div>
        </div>
      ) : (
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center space-x-2 mb-2">
            <Package className="h-4 w-4" />
            <h4 className="text-sm font-medium">FunASR 桌面端模型</h4>
          </div>
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>FunASR 模型仅在 Tauri 桌面端可用</span>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 flex items-start break-all">
          <AlertCircle className="h-3 w-3 mr-1 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
