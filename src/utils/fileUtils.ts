// 文件处理工具函数

import type { VideoFile } from '@/types/video';

const MEDIA_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  ogg: 'video/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

/**
 * 检查文件是否为视频文件
 */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

/**
 * 检查文件是否为音频文件
 */
export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/');
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.slice(lastDot + 1).toLowerCase();
}

/**
 * 生成唯一的文件名
 */
export function generateUniqueFilename(originalName: string, suffix = ''): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = getFileExtension(originalName);
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  
  return `${baseName}${suffix}_${timestamp}_${random}.${extension}`;
}

/**
 * 创建文件下载链接
 */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // 清理 URL 对象
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 读取文件为 ArrayBuffer
 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      if (e.target?.result instanceof ArrayBuffer) {
        resolve(e.target.result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 创建视频文件的 Object URL
 */
export function createVideoURL(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * 清理 Object URL
 */
export function revokeVideoURL(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * 获取视频文件的基本信息
 */
export async function getVideoInfo(file: File): Promise<{
  duration: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    
    video.onloadedmetadata = () => {
      const info = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      
      URL.revokeObjectURL(url);
      resolve(info);
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };
    
    video.src = url;
  });
}

/**
 * 验证文件类型
 */
export function validateFileType(file: File, allowedTypes: string[]): boolean {
  return allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      return file.type.startsWith(type.slice(0, -1));
    }
    return file.type === type;
  });
}

async function getMediaDurationFromUrl(url: string, isVideo: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = document.createElement(isVideo ? 'video' : 'audio');

    media.onloadedmetadata = () => {
      resolve(Number.isFinite(media.duration) ? media.duration : 0);
    };

    media.onerror = () => {
      reject(new Error('Failed to load media metadata'));
    };

    media.src = url;
  });
}

export type FetchProgressCallback = (loaded: number, total: number | null) => void;

/**
 * 拉取 URL 对应 Blob，可选上报下载进度（依赖 Content-Length）。
 */
export interface FetchBlobResult {
  blob: Blob;
  contentType: string | null;
}

export async function fetchBlobWithProgress(
  url: string,
  onProgress?: FetchProgressCallback,
): Promise<FetchBlobResult> {
  onProgress?.(0, null);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || null;
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? Number.parseInt(contentLength, 10) : null;

  if (!response.body || !onProgress) {
    const blob = await response.blob();
    onProgress?.(blob.size, total ?? blob.size);
    return { blob, contentType: blob.type || contentType };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }

  const blob = new Blob(chunks, contentType ? { type: contentType } : undefined);
  return { blob, contentType };
}

/**
 * 从远程 URL 加载视频或音频，返回可用于播放与 ASR 的 VideoFile。
 */
export async function loadMediaFromUrl(
  urlString: string,
  onProgress?: FetchProgressCallback,
): Promise<VideoFile> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString.trim());
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid URL protocol');
  }

  const { blob, contentType: fetchedContentType } = await fetchBlobWithProgress(parsedUrl.href, onProgress);
  const contentType = blob.type || fetchedContentType || '';
  const fileName = decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'media');
  const extension = getFileExtension(fileName);
  const type = contentType || MEDIA_MIME_BY_EXT[extension] || 'application/octet-stream';
  const file = new File([blob], fileName, { type });
  const objectUrl = createVideoURL(file);

  let duration = 0;
  if (type.startsWith('video/') || type.startsWith('audio/')) {
    try {
      duration = await getMediaDurationFromUrl(objectUrl, type.startsWith('video/'));
    } catch {
      duration = 0;
    }
  }

  return {
    file,
    url: objectUrl,
    duration,
    size: file.size,
    type,
    name: fileName,
  };
}