// ASR 识别设置面板 - 放在播放器下方"选项"标签页
// 浏览器端仅展示 Web 模型；Tauri 桌面端仅展示 FunASR 模型。下载请到设置弹窗。

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useShowInfo } from '@/stores/messageStore';
import { ASRLanguageSelector, ModelSelectItems, WebModelSelectItems } from '@/components/ASR';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BrainCircuit, Globe, Cpu, AlertCircle, Settings } from 'lucide-react';
import type { AllModelsStatus, AvailableModel } from '@/types/model';
import { asrService } from '@/services/asrService';
import { getWebAsrModel, WEB_ASR_MODELS } from '@/config/webAsrModels';
import { getRuntimeAsrEngineType, isTauriRuntime } from '@/utils/runtime';
import { useActiveModelTimestamp } from '@/hooks/useActiveModelTimestamp';
import { shouldAdvertiseWordLevelDelete } from '@/utils/wordLevelEdit';

interface ASRSettingsPanelProps {
  className?: string;
  onOpenSettings?: () => void;
}

export function ASRSettingsPanel({ className, onOpenSettings }: ASRSettingsPanelProps) {
  const language = useAppStore((s) => s.language);
  const deviceType = useAppStore((s) => s.deviceType);
  const asrEngineType = useAppStore((s) => s.asrEngineType);
  const asrModelId = useAppStore((s) => s.asrModelId);
  const webModelId = useAppStore((s) => s.webModelId);
  const isLoading = useAppStore((s) => s.isLoading);

  const setLanguage = useAppStore((s) => s.setLanguage);
  const setDeviceType = useAppStore((s) => s.setDeviceType);
  const setASREngineType = useAppStore((s) => s.setASREngineType);
  const setASRModelId = useAppStore((s) => s.setASRModelId);
  const setWebModelId = useAppStore((s) => s.setWebModelId);

  const showInfo = useShowInfo();

  const [isTauri, setIsTauri] = useState(false);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [allModels, setAllModels] = useState<AvailableModel[]>([]);
  const [currentWebModelReady, setCurrentWebModelReady] = useState(false);
  const activeModelTimestamp = useActiveModelTimestamp();
  const supportsWordLevelDelete = shouldAdvertiseWordLevelDelete(activeModelTimestamp);

  useEffect(() => {
    const tauri = isTauriRuntime();
    setIsTauri(tauri);

    const expectedEngine = getRuntimeAsrEngineType();
    if (asrEngineType !== expectedEngine) {
      setASREngineType(expectedEngine);
    }

    if (!tauri) {
      setCurrentWebModelReady(asrService.isWebModelReady(webModelId));
      return;
    }

    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<AllModelsStatus>('check_all_models_downloaded')
        .then((status) => setDownloadedModels(status.downloaded_model_ids))
        .catch((err) => console.error('Failed to check models:', err));
      invoke<AvailableModel[]>('list_available_models')
        .then((list) => setAllModels(list))
        .catch((err) => console.error('Failed to list available models:', err));
    });
  }, [asrEngineType, setASREngineType, webModelId]);

  useEffect(() => {
    if (isTauri) return;
    setCurrentWebModelReady(asrService.isWebModelReady(webModelId));
  }, [isTauri, webModelId, deviceType]);

  useEffect(() => {
    if (!isTauri) return;
    const handler = () => {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke<AllModelsStatus>('check_all_models_downloaded')
          .then((status) => setDownloadedModels(status.downloaded_model_ids))
          .catch(() => {});
        invoke<AvailableModel[]>('list_available_models')
          .then((list) => setAllModels(list))
          .catch(() => {});
      });
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [isTauri]);

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

  const changeFunasrModel = useCallback(
    (modelId: string) => {
      setASRModelId(modelId);
      const modelName = allModels.find((m) => m.id === modelId)?.name || modelId;
      showInfo('模型切换成功', `已切换到 ${modelName}`);
    },
    [setASRModelId, showInfo, allModels],
  );

  const changeWebModel = useCallback(
    (modelId: string) => {
      setWebModelId(modelId);
      const meta = getWebAsrModel(modelId);
      showInfo('模型切换成功', `已切换到 ${meta?.name || modelId}`);
    },
    [setWebModelId, showInfo],
  );

  const currentModelDownloaded = downloadedModels.includes(asrModelId);
  const currentWebModelKnown = !!getWebAsrModel(webModelId);

  const downloadHint = (label: string) => (
    <div className="flex items-center gap-2 p-1.5 border rounded-md bg-amber-50 dark:bg-amber-950/20 text-xs">
      <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      <span className="text-amber-700 dark:text-amber-400 flex-1">{label}</span>
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline font-medium shrink-0"
        >
          <Settings className="h-3 w-3" />
          <span>去下载</span>
        </button>
      )}
    </div>
  );

  // —— 浏览器端：仅 Web 模型 ——
  if (!isTauri) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="grid grid-cols-2 gap-3">
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

          <div className="space-y-1">
            <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              <span>计算设备</span>
            </label>
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
          </div>
        </div>

        <div className="space-y-1">
          <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
            <BrainCircuit className="h-3.5 w-3.5" />
            <span>浏览器识别模型</span>
          </label>
          <Select
            value={currentWebModelKnown ? webModelId : WEB_ASR_MODELS[0]?.id}
            onValueChange={(v) => changeWebModel(v)}
            disabled={isLoading}
          >
            <SelectTrigger size="sm" className="w-full text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <WebModelSelectItems />
            </SelectContent>
          </Select>
          {!currentWebModelReady && downloadHint('当前模型尚未加载，识别前需先下载')}
          {supportsWordLevelDelete && (
            <p className="text-[11px] text-muted-foreground">
              该模型支持字词级时间戳，识别后可按字词删除并精剪视频。
            </p>
          )}
        </div>
      </div>
    );
  }

  // —— Tauri 桌面端：仅 FunASR 模型 ——
  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid grid-cols-2 gap-3">
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

        <div className="space-y-1">
          <label className="flex items-center space-x-1.5 text-xs font-medium text-muted-foreground">
            <BrainCircuit className="h-3.5 w-3.5" />
            <span>桌面端识别模型</span>
          </label>
          {downloadedModels.length > 0 ? (
            <Select
              value={currentModelDownloaded ? asrModelId : downloadedModels[0]}
              onValueChange={(v) => changeFunasrModel(v)}
              disabled={isLoading}
            >
              <SelectTrigger size="sm" className="w-full text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <ModelSelectItems
                  allModels={allModels}
                  downloadedModelIds={downloadedModels}
                />
              </SelectContent>
            </Select>
          ) : (
            downloadHint('未下载桌面端模型')
          )}
          {supportsWordLevelDelete && (
            <p className="text-[11px] text-muted-foreground">
              该模型已验证字词级时间戳（token_timestamp_verified），识别后可按字词删除。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}