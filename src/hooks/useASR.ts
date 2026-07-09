// ASR 语音识别 Hook
// 浏览器：Transformers；Tauri：始终 FunASR 本地模型（无 path 时先落盘临时文件）

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { useHistoryStore } from '@/stores/historyStore';
import { asrService } from '@/services/asrService';
import type { ASRProgress } from '@/types/subtitle';
import type { VideoFile } from '@/types/video';
import { readFileAsArrayBuffer } from '@/utils/fileUtils';
import { getRuntimeAsrEngineType, isTauriRuntime } from '@/utils/runtime';
import { useTranslation } from '@/contexts/LocaleProvider';
import { resolveFunasrModelId } from '@/utils/asrModelId';
import {
  attachTauriMediaPath,
  ensureTauriLocalMediaPath,
  readTauriMediaPath,
} from '@/utils/tauriMediaPath';

const ASR_ERROR_TOAST_ID = 'asr-error';

const LOADING_STATUSES: ASRProgress['status'][] = [
  'loading',
  'initiate',
  'progress',
  'running',
];

export interface UseASRReturn {
  isASRLoading: boolean;
  asrProgress: ASRProgress | null;
  startASR: (videoFile: VideoFile) => Promise<void>;
}

export function useASR(): UseASRReturn {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const asrModelId = useAppStore((s) => s.asrModelId);
  const webModelId = useAppStore((s) => s.webModelId);
  const deviceType = useAppStore((s) => s.deviceType);
  const asrEngineType = useAppStore((s) => s.asrEngineType);
  const asrProgress = useAppStore((s) => s.asrProgress);
  const isLoading = useAppStore((s) => s.isLoading);

  const setASRProgress = useAppStore((s) => s.setASRProgress);
  const setError = useAppStore((s) => s.setError);
  const setLoading = useAppStore((s) => s.setLoading);
  const setStage = useAppStore((s) => s.setStage);
  const setVideoFile = useAppStore((s) => s.setVideoFile);
  const setTranscript = useHistoryStore((s) => s.setTranscript);
  const setASREngineType = useAppStore((s) => s.setASREngineType);

  const latestRef = useRef({ language, asrModelId, webModelId });
  latestRef.current = { language, asrModelId, webModelId };

  const reportAsrError = useCallback((message: string) => {
    setError(message);
    toast.error(t('messages.asr.asrFailed'), {
      id: ASR_ERROR_TOAST_ID,
      description: message,
    });
  }, [setError, t]);

  useEffect(() => {
    const handleProgress = (progress: ASRProgress) => {
      setASRProgress(progress);

      if (progress.status === 'complete' && progress.result) {
        setTranscript(progress.result);
        setStage('edit');
      }

      if (progress.status === 'error') {
        const message = progress.error || t('messages.asr.asrFailed');
        reportAsrError(message);
      }
    };

    return asrService.addProgressCallback(handleProgress);
  }, [setASRProgress, setTranscript, setStage, reportAsrError, t]);

  useEffect(() => {
    asrService.setDevice(deviceType);
  }, [deviceType]);

  useEffect(() => {
    const expected = getRuntimeAsrEngineType();
    asrService.setEngineType(expected);
    if (asrEngineType !== expected) {
      setASREngineType(expected);
    }
  }, [asrEngineType, setASREngineType]);

  const startASR = useCallback(
    async (videoFile: VideoFile) => {
      try {
        setLoading(true);

        if (isTauriRuntime()) {
          asrService.setEngineType('funasr-tauri');

          setASRProgress({ status: 'loading', data: '准备本地媒体文件...' });
          const inputPath = await ensureTauriLocalMediaPath(videoFile);
          if (!readTauriMediaPath(videoFile)) {
            setVideoFile(attachTauriMediaPath(videoFile, inputPath));
          }

          const funasrModelId = resolveFunasrModelId(latestRef.current.asrModelId);
          setASRProgress({ status: 'loading', data: '检查 FunASR 运行环境...' });
          await asrService.prepareModel(funasrModelId);
          setASRProgress({ status: 'loading', data: '开始转录音频...' });
          await asrService.transcribeWithPath(
            inputPath,
            latestRef.current.language,
            funasrModelId,
          );
          return;
        }

        setASRProgress({ status: 'loading', data: '正在准备音频数据...' });
        const audioBuffer = await readFileAsArrayBuffer(videoFile.file);

        const activeWebModelId = latestRef.current.webModelId;
        if (!(await asrService.isWebModelDownloaded(activeWebModelId))) {
          throw new Error('当前模型尚未下载，请先在设置中下载浏览器识别模型');
        }

        asrService.setEngineType('transformers');
        setASRProgress({ status: 'loading', data: '正在加载模型...' });
        await asrService.prepareModel(activeWebModelId);

        setASRProgress({ status: 'loading', data: '开始转录音频...' });
        await asrService.transcribeAudio(
          audioBuffer,
          latestRef.current.language,
        );
      } catch (error) {
        console.error('ASR转录失败:', error);
        const errorMessage = error instanceof Error ? error.message : t('messages.asr.asrFailed');
        reportAsrError(errorMessage);
        setASRProgress({ status: 'error', error: errorMessage });
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setASRProgress, setVideoFile, reportAsrError, t],
  );

  const isASRLoading = useMemo(
    () => isLoading || (asrProgress ? LOADING_STATUSES.includes(asrProgress.status) : false),
    [isLoading, asrProgress],
  );

  return { isASRLoading, asrProgress, startASR };
}