// FunASR 模型下载管理类型

export interface ModelFile {
  path: string;
  url: string;
  size_bytes: number;
  /** 镜像下载地址列表（主地址失败后依次尝试） */
  mirrors?: string[];
}

export interface AvailableModel {
  id: string;
  name: string;
  description: string;
  size_bytes: number;
  files: ModelFile[];
}

export interface ModelDownloadProgress {
  model_id: string;
  current_file: string;
  file_index: number;
  total_files: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: 'downloading' | 'skipped' | 'complete' | 'error';
  error?: string;
}

export interface ModelDownloadState {
  isDownloading: boolean;
  currentModelId: string | null;
  progress: ModelDownloadProgress | null;
  downloadedModels: Set<string>;
}

// 全量下载状态（后端 check_all_models_downloaded 返回）
export interface AllModelsStatus {
  all_downloaded: boolean;
  downloaded_model_ids: string[];
  total_models: number;
  downloaded_count: number;
  total_size_bytes: number;
  downloaded_size_bytes: number;
}
