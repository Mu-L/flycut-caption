// 字幕相关类型定义

export interface SubtitleChunk {
  text: string;
  secondText?: string; // 副字幕文本
  timestamp: [number, number]; // [start, end] in seconds
  id: string;
  selected?: boolean; // 是否被选中删除
  deleted?: boolean; // 是否被删除
}

export interface SubtitleTranscript {
  text: string;
  chunks: SubtitleChunk[];
  language: string;
  duration: number;
}

export interface ASRProgress {
  status: 'loading' | 'initiate' | 'progress' | 'done' | 'ready' | 'loaded' | 'running' | 'complete' | 'error' | 'reset';
  data?: string;
  file?: string;
  progress?: number;
  total?: number;
  result?: SubtitleTranscript;
  time?: number;
  error?: string;
}

export interface SubtitleEditorState {
  transcript: SubtitleTranscript | null;
  currentTime: number;
  selectedChunks: Set<string>;
  isProcessing: boolean;
  processingProgress: number;
}

export type SubtitleAction = 
  | { type: 'SET_TRANSCRIPT'; transcript: SubtitleTranscript }
  | { type: 'SET_CURRENT_TIME'; time: number }
  | { type: 'TOGGLE_CHUNK_SELECTION'; chunkId: string }
  | { type: 'SELECT_ALL_CHUNKS' }
  | { type: 'DESELECT_ALL_CHUNKS' }
  | { type: 'SET_PROCESSING'; isProcessing: boolean }
  | { type: 'SET_PROCESSING_PROGRESS'; progress: number }
  | { type: 'RESET' };