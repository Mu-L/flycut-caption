import type { VideoFile } from '@/types/video';
import { readFileAsArrayBuffer } from '@/utils/fileUtils';
import { isTauriRuntime } from '@/utils/runtime';

export function readTauriMediaPath(videoFile: VideoFile): string | undefined {
  return videoFile.path || (videoFile.file as File & { path?: string }).path;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

async function stageBytes(fileName: string, buffer: ArrayBuffer): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('stage_media_file', {
    fileName,
    bytes: Array.from(new Uint8Array(buffer)),
  });
}

/**
 * 确保 Tauri 场景下有可传给 FunASR / FFmpeg 的本地文件路径。
 * 原生选择器已有 path；URL / 示例视频 / 浏览器式 File 会先落盘到临时目录。
 */
export async function ensureTauriLocalMediaPath(videoFile: VideoFile): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('ensureTauriLocalMediaPath 仅在 Tauri 环境可用');
  }

  const existingPath = readTauriMediaPath(videoFile);
  if (existingPath) return existingPath;

  const fileName = videoFile.name || 'media.mp4';
  const url = videoFile.url?.trim() ?? '';

  if (videoFile.file.size > 0) {
    const buffer = await readFileAsArrayBuffer(videoFile.file);
    return stageBytes(fileName, buffer);
  }

  if (isHttpUrl(url)) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('download_media_to_temp', {
      url,
      fileName: videoFile.name || null,
    });
  }

  if (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`无法读取媒体: HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return stageBytes(fileName, buffer);
  }

  throw new Error('无法获取本地媒体路径，请重新选择文件');
}

/** 将落盘后的 path 写回 VideoFile，便于后续 FFmpeg 导出复用 */
export function attachTauriMediaPath(videoFile: VideoFile, path: string): VideoFile {
  if (videoFile.path === path) return videoFile;
  return { ...videoFile, path };
}