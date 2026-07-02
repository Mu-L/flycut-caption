// 模型下载面板
// 浏览器端：仅展示 Transformers.js 模型；Tauri 桌面端：仅展示 FunASR 模型。
// VAD (silero-vad) 已内置到安装包，不在此面板展示。

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Download, CheckCircle2, Loader2, AlertCircle, List, SkipForward } from 'lucide-react';
import type {
  AvailableModel,
  ModelDownloadProgress,
  AllModelsStatus,
} from '@/types/model';
import { MODEL_FAMILY_LABELS } from '@/types/model';
import type { ASRProgress } from '@/types/subtitle';
import { useAppStore } from '@/stores/appStore';
import { asrService } from '@/services/asrService';
import { WEB_ASR_MODELS, WEB_MODEL_FAMILY_LABELS } from '@/config/webAsrModels';
import { isTauriRuntime } from '@/utils/runtime';

type ReadyWebModels = Record<string, boolean>;
type DownloadType = string | null;

interface ModelDownloadPanelProps {
  className?: string;
}

function formatSize(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function pctFromBytes(downloaded: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

export function ModelDownloadPanel({ className }: ModelDownloadPanelProps) {
  const [isTauri, setIsTauri] = useState(false);

  // —— 浏览器模型状态 ——
  const [readyWebModels, setReadyWebModels] = useState<ReadyWebModels>({});
  const [whisperProgress, setWhisperProgress] = useState<ASRProgress | null>(null);

  // —— 桌面端模型状态 ——
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [status, setStatus] = useState<AllModelsStatus | null>(null);
  const [funasrProgress, setFunasrProgress] = useState<ModelDownloadProgress | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [downloadingType, setDownloadingType] = useState<DownloadType>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceType = useAppStore((s) => s.deviceType);
  const webModelId = useAppStore((s) => s.webModelId);

  const refreshReadyWebModels = useCallback(() => {
    const next: ReadyWebModels = {};
    for (const m of WEB_ASR_MODELS) {
      next[m.id] = asrService.isWebModelReady(m.id);
    }
    setReadyWebModels(next);
  }, []);

  useEffect(() => {
    setIsTauri(isTauriRuntime());
    refreshReadyWebModels();
  }, [webModelId, deviceType, refreshReadyWebModels]);

  const loadClientStatus = useCallback(async () => {
    if (!isTauriRuntime()) return;

    setIsLoadingModels(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const [list, allStatus] = await Promise.all([
        invoke<AvailableModel[]>('list_available_models'),
        invoke<AllModelsStatus>('check_all_models_downloaded'),
      ]);
      setModels(list);
      setStatus(allStatus);
      setError(null);
    } catch (err) {
      const message = typeof err === 'string' ? err
        : err instanceof Error ? err.message
        : String((err as Record<string, unknown>).message || err);
      console.error('Failed to load models:', err);
      setError(`模型清单加载失败：${message}`);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (isTauri) {
      loadClientStatus();
    }
  }, [isTauri, loadClientStatus]);

  // 桌面端下载进度
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<ModelDownloadProgress>('model-download-progress', (event) => {
        const p = event.payload;
        // 忽略内置 VAD 等非 manifest 模型 id 的进度
        if (!models.some((m) => m.id === p.model_id)) {
          return;
        }
        setFunasrProgress(p);
        if (p.status === 'complete') {
          setDownloadingType(null);
          setError(null);
          loadClientStatus();
        }
        if (p.status === 'error') {
          setDownloadingType(null);
          setError(p.error || '下载失败');
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [isTauri, loadClientStatus, models]);

  const startDownloadModel = useCallback(async (modelId: string) => {
    setDownloadingType(`model-${modelId}`);
    setFunasrProgress(null);
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('download_model', { modelId });
    } catch (err) {
      setDownloadingType(null);
      const message = typeof err === 'string' ? err
        : err instanceof Error ? err.message
        : String(err);
      console.error('[ModelDownload] model download failed:', err);
      setError(message);
    }
  }, []);

  const startDownloadWebModel = useCallback(async (targetWebModelId: string) => {
    setDownloadingType(`web-${targetWebModelId}`);
    setWhisperProgress(null);
    setError(null);

    asrService.setWhisperProgressCallback((progress) => {
      setWhisperProgress(progress);
      if (progress.status === 'loaded') {
        setDownloadingType(null);
        setError(null);
        setReadyWebModels((prev) => ({ ...prev, [targetWebModelId]: true }));
      }
      if (progress.status === 'error') {
        setDownloadingType(null);
        setError(progress.error || `${targetWebModelId} 模型下载失败`);
      }
    });

    try {
      await asrService.preloadWebModel(targetWebModelId, deviceType);
    } catch (err) {
      setDownloadingType(null);
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ModelDownload] Web model download failed:', err);
      setError(message);
    }
  }, [deviceType]);

  const renderDownloadButton = (
    isReady: boolean,
    isDownloading: boolean,
    onClick: () => void,
  ) => (
    <button
      type="button"
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

  const renderFunasrCardProgress = (progress: ModelDownloadProgress) => {
    const pct = pctFromBytes(progress.downloaded_bytes, progress.total_bytes);
    return (
      <div className="space-y-1.5 pt-2 border-t border-border/60">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground truncate max-w-[75%]">
            {progress.status === 'skipped' ? (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <SkipForward className="h-3 w-3" />
                已存在，跳过
              </span>
            ) : (
              progress.current_file
            )}
          </span>
          <span className="font-medium tabular-nums">{pct}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              progress.status === 'skipped' ? 'bg-blue-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.total_bytes > 0 && (
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {formatSize(progress.downloaded_bytes)} / {formatSize(progress.total_bytes)}
          </p>
        )}
      </div>
    );
  };

  const renderWebCardProgress = (progress: ASRProgress) => {
    const pct = progress.progress ?? 0;
    return (
      <div className="space-y-1.5 pt-2 border-t border-border/60">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground truncate max-w-[75%]">
            {progress.data || progress.file || '下载中...'}
          </span>
          {progress.progress !== undefined && (
            <span className="font-medium tabular-nums">{Math.round(pct)}%</span>
          )}
        </div>
        {progress.progress !== undefined && (
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    );
  };

  const errorBlock = error ? (
    <p className="text-xs text-red-500 flex items-start break-all">
      <AlertCircle className="h-3 w-3 mr-1 mt-0.5 shrink-0" />
      <span>{error}</span>
    </p>
  ) : null;

  const listHeader = (
    <div className="flex items-center space-x-2">
      <List className="h-4 w-4 text-muted-foreground" />
      <h4 className="text-sm font-medium">模型列表</h4>
    </div>
  );

  // —— 浏览器端：仅 Web 模型 ——
  if (!isTauri) {
    return (
      <div className={cn('space-y-3', className)}>
        {listHeader}
        <div className="space-y-3">
          {Object.entries(WEB_MODEL_FAMILY_LABELS).map(([family, label]) => {
            const familyModels = WEB_ASR_MODELS.filter((m) => m.family === family);
            if (familyModels.length === 0) return null;
            return (
              <div key={family} className="space-y-2">
                <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {label}
                </h5>
                {familyModels.map((model) => {
                  const isReady = readyWebModels[model.id] ?? false;
                  const isDownloading = downloadingType === `web-${model.id}`;
                  const isActive = webModelId === model.id;
                  const showProgress = isDownloading && whisperProgress;

                  return (
                    <div
                      key={model.id}
                      className={cn(
                        'p-3 border rounded-md bg-background space-y-0',
                        isReady && 'border-green-300 bg-green-50 dark:bg-green-950/20',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{model.name}</span>
                            {model.recommended && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                推荐
                              </span>
                            )}
                            {model.family === 'moonshine' && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                EN
                              </span>
                            )}
                            {isActive && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                                当前
                              </span>
                            )}
                            {isReady && (
                              <span className="text-xs text-green-600 flex items-center shrink-0">
                                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                                已就绪
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {model.sizeHint} · {deviceType === 'webgpu' ? 'WebGPU' : 'WASM'}
                            {!model.modelBaseUrl && (
                              <span className="ml-1 text-amber-600 dark:text-amber-400">
                                · 从 HuggingFace 拉取
                              </span>
                            )}
                          </p>
                        </div>
                        {renderDownloadButton(isReady, isDownloading, () => startDownloadWebModel(model.id))}
                      </div>
                      {showProgress && renderWebCardProgress(whisperProgress)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {errorBlock}
      </div>
    );
  }

  // —— Tauri 桌面端：仅 FunASR 模型 ——
  return (
    <div className={cn('space-y-3', className)}>
      {listHeader}
      <div className="space-y-3">
        {isLoadingModels && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>正在加载模型清单...</span>
          </div>
        )}

        {!isLoadingModels && models.length === 0 && !error && (
          <p className="text-xs text-muted-foreground py-2">未加载到模型，请重启应用后重试。</p>
        )}

        {Object.entries(MODEL_FAMILY_LABELS).map(([family, label]) => {
          const familyModels = models.filter((m) => m.family === family);
          if (familyModels.length === 0) return null;
          return (
            <div key={family} className="space-y-2">
              <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {label}
              </h5>
              {familyModels.map((model) => {
                const isDownloaded = status?.downloaded_model_ids.includes(model.id) ?? false;
                const isDownloading = downloadingType === `model-${model.id}`;
                const showProgress = isDownloading && funasrProgress;

                return (
                  <div
                    key={model.id}
                    className={cn(
                      'p-3 border rounded-md bg-background',
                      isDownloaded && 'border-green-300 bg-green-50 dark:bg-green-950/20',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{model.name}</span>
                          {model.recommended && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                              推荐
                            </span>
                          )}
                          {model.quantization && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                              {model.quantization}
                            </span>
                          )}
                          {isDownloaded && (
                            <span className="text-xs text-green-600 flex items-center shrink-0">
                              <CheckCircle2 className="h-3 w-3 mr-0.5" />
                              已下载
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          大小: {model.artifact.size_mb_estimate
                            ? formatSize(model.artifact.size_mb_estimate * 1_000_000)
                            : '未知'}
                        </p>
                      </div>
                      {renderDownloadButton(
                        isDownloaded,
                        isDownloading,
                        () => startDownloadModel(model.id),
                      )}
                    </div>
                    {showProgress && renderFunasrCardProgress(funasrProgress)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {errorBlock}
    </div>
  );
}