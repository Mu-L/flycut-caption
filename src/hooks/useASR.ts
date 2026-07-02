// ASR 语音识别 Hook
// 封装 ASR 识别流程，不弹出 toast 消息，仅更新 store 状态，
// 由 UI 层根据 asrProgress / isASRLoading 自行展示加载状态。

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useHistoryStore } from '@/stores/historyStore';
import { asrService } from '@/services/asrService';
import type { ASRProgress } from '@/types/subtitle';
import type { VideoFile } from '@/types/video';
import { readFileAsArrayBuffer } from '@/utils/fileUtils';
import { getRuntimeAsrEngineType, isTauriRuntime } from '@/utils/runtime';

// 处于"进行中"的状态集合
const LOADING_STATUSES: ASRProgress['status'][] = [
  'loading',
  'initiate',
  'progress',
  'running',
];

export interface UseASRReturn {
  /** 是否正在识别（含模型加载/转录过程） */
  isASRLoading: boolean;
  /** 当前进度信息 */
  asrProgress: ASRProgress | null;
  /** 开始识别指定视频文件的音频 */
  startASR: (videoFile: VideoFile) => Promise<void>;
}

export function useASR(): UseASRReturn {
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
  const setTranscript = useHistoryStore((s) => s.setTranscript);
  const setASREngineType = useAppStore((s) => s.setASREngineType);

  // 保持最新的 language/modelId 引用，避免回调闭包过期
  const latestRef = useRef({ language, asrModelId, webModelId });
  latestRef.current = { language, asrModelId, webModelId };

  // 设置进度回调（不弹出消息，仅更新状态）
  useEffect(() => {
    const handleProgress = (progress: ASRProgress) => {
      setASRProgress(progress);

      if (progress.status === 'complete' && progress.result) {
        setTranscript(progress.result);
        setStage('edit');
      }

      if (progress.status === 'error') {
        setError(`ASR处理失败: ${progress.error}`);
      }
    };

    asrService.setProgressCallback(handleProgress);

    return () => {
      asrService.setProgressCallback(() => {});
    };
  }, [setASRProgress, setTranscript, setError, setStage]);

  // 同步设备类型 / 引擎类型到 service
  useEffect(() => {
    asrService.setDevice(deviceType);
  }, [deviceType]);

  // 按运行环境锁定引擎：浏览器 = Transformers，Tauri = FunASR
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

        // FunASR Tauri 引擎需要本地文件路径而非 ArrayBuffer
        // 优先使用 VideoFile.path（Tauri 原生文件选择器提供），
        // 回退到 File.path（Tauri v1 或开启了 path 暴露的 v2）
        const isTauri = isTauriRuntime();
        const filePath =
          videoFile.path ||
          (isTauri ? (videoFile.file as File & { path?: string }).path : undefined);

        if (isTauri) {
          if (!filePath) {
            throw new Error('Tauri 引擎需要本地文件路径，请通过文件选择器选择本地文件');
          }
          setASRProgress({ status: 'loading', data: '检查 FunASR 运行环境...' });
          await asrService.prepareModel(latestRef.current.asrModelId);
          setASRProgress({ status: 'loading', data: '开始转录音频...' });
          await asrService.transcribeWithPath(
            filePath,
            latestRef.current.language,
            latestRef.current.asrModelId,
          );
          return;
        }

        // Transformers / Whisper 引擎：使用 ArrayBuffer
        setASRProgress({ status: 'loading', data: '正在准备音频数据...' });
        const audioBuffer = await readFileAsArrayBuffer(videoFile.file);

        // 确保指定 Web 模型已准备（传 Web 短 id，引擎层负责切换/加载）
        if (!asrService.isReady() || !asrService.isWebModelReady(latestRef.current.webModelId)) {
          setASRProgress({ status: 'loading', data: '准备模型中...' });
          await asrService.prepareModel(latestRef.current.webModelId);
        }

        // 进行转录（transformers 引擎忽略 modelId 参数，使用 prepareModel 时已设置的模型）
        setASRProgress({ status: 'loading', data: '开始转录音频...' });
        await asrService.transcribeAudio(
          audioBuffer,
          latestRef.current.language,
        );
        // 注意：不在此处设置 transcript，统一交由 progress callback 处理
      } catch (error) {
        console.error('ASR转录失败:', error);
        const errorMessage = error instanceof Error ? error.message : '转录失败';
        setError(errorMessage);
        setASRProgress({ status: 'error', error: errorMessage });
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setError, setASRProgress],
  );

  const isASRLoading = useMemo(
    () => isLoading || (asrProgress ? LOADING_STATUSES.includes(asrProgress.status) : false),
    [isLoading, asrProgress],
  );

  return { isASRLoading, asrProgress, startASR };
}
