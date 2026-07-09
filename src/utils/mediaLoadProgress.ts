export const MEDIA_LOAD_PHASE = {
  START: 1,
  DOWNLOAD_MAX: 95,
  METADATA: 97,
  FINALIZING: 99,
  COMPLETE: 100,
} as const;

/** 下载阶段：已知总大小时最高 95%；未知时按已加载字节估算，避免直接跳到 100% */
export function calcDownloadProgress(loaded: number, total: number | null): number {
  if (loaded <= 0) {
    return MEDIA_LOAD_PHASE.START;
  }

  if (total != null && total > 0) {
    return Math.min(
      MEDIA_LOAD_PHASE.DOWNLOAD_MAX,
      Math.max(MEDIA_LOAD_PHASE.START, Math.round((loaded / total) * MEDIA_LOAD_PHASE.DOWNLOAD_MAX)),
    );
  }

  const megabytes = loaded / (1024 * 1024);
  const estimated = Math.round(8 + (1 - Math.exp(-megabytes / 1.5)) * 84);
  return Math.min(92, Math.max(2, estimated));
}