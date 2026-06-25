// ASR 识别设置面板 - 放在播放器下方"选项"标签页
// 仅提供已下载模型的选择，下载请到设置弹窗

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useShowSuccess, useShowInfo } from '@/stores/messageStore';
import { ASRLanguageSelector } from '@/components/ASR';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BrainCircuit, Globe, Cpu, AlertCircle, Settings } from 'lucide-react';
import type { AllModelsStatus } from '@/types/model';
import { asrService } from '@/services/asrService';

interface ASRSettingsPanelProps {
  className?: string;
  onOpenSettings?: () => void;
}

// FunASR 模型显示名称映射
const MODEL_NAMES: Record<string, string> = {
  'sensevoice-small-int8': 'SenseVoice Small (多语种)',
  'paraformer-small-int8': 'Paraformer Small (中文优先)',
};

export function ASRSettingsPanel({ className, onOpenSettings }: ASRSettingsPanelProps) {
  const language = useAppStore((s) => s.language);
  const deviceType = useAppStore((s) => s.deviceType);
  const asrEngineType = useAppStore((s) => s.asrEngineType);
  const asrModelId = useAppStore((s) => s.asrModelId);
  const isLoading = useAppStore((s) => s.isLoading);

  const setLanguage = useAppStore((s) => s.setLanguage);
  const setDeviceType = useAppStore((s) => s.setDeviceType);
  const setASREngineType = useAppStore((s) => s.setASREngineType);
  const setASRModelId = useAppStore((s) => s.setASRModelId);

  const showSuccess = useShowSuccess();
  const showInfo = useShowInfo();

  // 已下载的 FunASR 模型列表
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [isTauri, setIsTauri] = useState(false);
  const [whisperReady, setWhisperReady] = useState(false);

  useEffect(() => {
    const tauri = '__TAURI_INTERNALS__' in window;
    setIsTauri(tauri);
    setWhisperReady(asrService.isWhisperReady());
    if (!tauri) return;

    // 加载已下载的模型列表
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<AllModelsStatus>('check_all_models_downloaded')
        .then((status) => {
          setDownloadedModels(status.downloaded_model_ids);
        })
        .catch((err) => console.error('Failed to check models:', err));
    });
  }, []);

  // 监听窗口聚焦时刷新已下载模型（用户可能在设置弹窗下载后回来）
  useEffect(() => {
    if (!isTauri) return;
    const handler = () => {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke<AllModelsStatus>('check_all_models_downloaded')
          .then((status) => setDownloadedModels(status.downloaded_model_ids))
          .catch(() => {});
      });
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [isTauri]);

  const changeEngine = useCallback(
    (engine: 'transformers' | 'funasr-tauri') => {
      setASREngineType(engine);
      const name = engine === 'funasr-tauri' ? 'FunASR Tauri 本地' : 'Whisper 浏览器本地';
      showSuccess('引擎切换成功', `已切换到 ${name}`);
    },
    [setASREngineType, showSuccess],
  );

  const changeLanguage = useCallback(
    (newLanguage: string) => {
      setLanguage(newLanguage);
    },
    [setLanguage],
  );

  const changeDevice = useCallback(
    (device: 'webgpu' | 'wasm') => {
      setDeviceType(device);
      const name = device === 'webgpu' ? 'WebGPU' : 'WebAssembly';
      showInfo('设备切换成功', `已切换到 ${name}`);
    },
    [setDeviceType, showInfo],
  );

  const changeModel = useCallback(
    (modelId: string) => {
      setASRModelId(modelId);
      const modelName = MODEL_NAMES[modelId] || modelId;
      showInfo('模型切换成功', `已切换到 ${modelName}`);
    },
    [setASRModelId, showInfo],
  );

  // FunASR 模型是否可用
  const funasrAvailable = !isTauri || downloadedModels.length > 0;
  // Whisper 模型是否可用
  const whisperAvailable = whisperReady;
  // 当前选中的模型是否已下载
  const currentModelDownloaded = downloadedModels.includes(asrModelId);

  return (
    <div className={cn('space-y-3', className)}>
      {/* 引擎 + 语言 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 识别引擎 */}
        <div className="space-y-1">
          <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
            <BrainCircuit className="h-3.5 w-3.5" />
            <span>识别引擎</span>
          </label>
          <Select
            value={asrEngineType}
            onValueChange={(v) => changeEngine(v as 'transformers' | 'funasr-tauri')}
            disabled={isLoading}
          >
            <SelectTrigger size="sm" className="w-full text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="transformers" disabled={!whisperAvailable}>
                Whisper 浏览器本地{!whisperAvailable ? ' (未下载模型)' : ''}
              </SelectItem>
              <SelectItem value="funasr-tauri" disabled={!funasrAvailable}>
                FunASR Tauri 本地{!funasrAvailable ? ' (未下载模型)' : ''}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 识别语言 */}
        <div className="space-y-1">
          <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            <span>识别语言</span>
          </label>
          <ASRLanguageSelector
            language={language}
            onLanguageChange={changeLanguage}
            disabled={isLoading}
            placeholder="搜索语言..."
          />
        </div>
      </div>

      {/* 设备 / 模型选择（根据引擎动态显示） */}
      <div className="grid grid-cols-2 gap-3">
        {/* 计算设备 - 仅 Transformers */}
        {asrEngineType === 'transformers' && (
          <div className="space-y-1">
            <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              <span>计算设备</span>
            </label>
            {!whisperReady ? (
              <div className="flex items-center gap-2 p-1.5 border rounded-md bg-amber-50 dark:bg-amber-950/20 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="text-amber-700 dark:text-amber-400 flex-1">未下载 Whisper 模型</span>
                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline font-medium shrink-0"
                  >
                    <Settings className="h-3 w-3" />
                    <span>去下载</span>
                  </button>
                )}
              </div>
            ) : (
              <Select
                value={deviceType}
                onValueChange={(v) => changeDevice(v as 'webgpu' | 'wasm')}
                disabled={isLoading}
              >
                <SelectTrigger size="sm" className="w-full text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webgpu">WebGPU (推荐)</SelectItem>
                  <SelectItem value="wasm">WebAssembly (兼容)</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* 识别模型 - 仅 FunASR，只显示已下载的模型 */}
        {asrEngineType === 'funasr-tauri' && (
          <div className="space-y-1">
            <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
              <BrainCircuit className="h-3.5 w-3.5" />
              <span>识别模型</span>
            </label>
            {downloadedModels.length > 0 ? (
              <Select
                value={currentModelDownloaded ? asrModelId : downloadedModels[0]}
                onValueChange={(v) => changeModel(v)}
                disabled={isLoading}
              >
                <SelectTrigger size="sm" className="w-full text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {downloadedModels.map((modelId) => (
                    <SelectItem key={modelId} value={modelId}>
                      {MODEL_NAMES[modelId] || modelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 p-1.5 border rounded-md bg-amber-50 dark:bg-amber-950/20 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="text-amber-700 dark:text-amber-400 flex-1">未下载模型</span>
                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline font-medium shrink-0"
                  >
                    <Settings className="h-3 w-3" />
                    <span>去下载</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
