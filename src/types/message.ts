// 消息中心类型定义

export type MessageType = 'info' | 'success' | 'warning' | 'error' | 'processing';

export interface VideoProcessingProgress {
  stage: 'analyzing' | 'cutting' | 'encoding' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
}

export interface Message {
  id: string;
  type: MessageType;
  title: string;
  content?: string;
  timestamp: number;
  read: boolean;
  persistent?: boolean; // 是否持久化显示
  progress?: VideoProcessingProgress; // 视频处理进度
  processingResult?: {
    blob?: Blob;
    filename: string;
    savedPath?: string;
  };
  action?: {
    label: string;
    handler: () => void;
  };
}

export interface ToastMessage {
  id: string;
  type: MessageType;
  title: string;
  content?: string;
  duration?: number; // Toast显示时长，0表示不自动关闭
  action?: {
    label: string;
    handler: () => void;
  };
}