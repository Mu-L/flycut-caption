// 消息中心状态管理 Zustand Store
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { toast } from 'sonner';
import { saveFile } from '@/utils/createFileWriter';
import type { Message, VideoProcessingProgress } from '@/types/message';

interface MessageState {
  messages: Message[];
  unreadCount: number;
}

interface MessageActions {
  // 消息中心操作
  addMessage: (message: Omit<Message, 'id' | 'timestamp' | 'read'>) => string;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  
  // 便捷方法
  showSuccess: (title: string, content?: string) => void;
  showError: (title: string, content?: string) => void;
  showWarning: (title: string, content?: string) => void;
  showInfo: (title: string, content?: string) => void;
  
  // 视频处理相关方法
  startVideoProcessing: (title: string) => string;
  updateVideoProcessingProgress: (id: string, progress: VideoProcessingProgress) => void;
  completeVideoProcessing: (
    id: string,
    blob: Blob | null,
    filename: string,
    savedPath?: string,
  ) => void;
  errorVideoProcessing: (id: string, error: string) => void;
}

type MessageStore = MessageState & MessageActions;

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

export const useMessageStore = create<MessageStore>()(
  devtools(
    (set, get) => ({
      // 初始状态
      messages: [],
      unreadCount: 0,
      
      // 消息中心操作
      addMessage: (message) => {
        const id = generateId();
        const newMessage: Message = {
          ...message,
          id,
          timestamp: Date.now(),
          read: false,
        };
        
        set((state) => ({
          messages: [newMessage, ...state.messages],
          unreadCount: state.unreadCount + 1,
        }));
        
        return id;
      },
      
      updateMessage: (id, updates) => {
        set((state) => ({
          messages: state.messages.map(msg => 
            msg.id === id ? { ...msg, ...updates } : msg
          ),
        }));
      },
      
      markAsRead: (id) => {
        set((state) => ({
          messages: state.messages.map(msg => 
            msg.id === id && !msg.read 
              ? { ...msg, read: true }
              : msg
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        }));
      },
      
      markAllAsRead: () => {
        set((state) => ({
          messages: state.messages.map(msg => ({ ...msg, read: true })),
          unreadCount: 0,
        }));
      },
      
      removeMessage: (id) => {
        set((state) => {
          const messageToRemove = state.messages.find(msg => msg.id === id);
          const wasUnread = messageToRemove && !messageToRemove.read;
          
          return {
            messages: state.messages.filter(msg => msg.id !== id),
            unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
          };
        });
      },
      
      clearMessages: () => {
        set({ messages: [], unreadCount: 0 });
      },
      
      // 便捷方法
      showSuccess: (title, content) => {
        toast.success(title, {
          description: content,
        });
        // 仍然添加到消息中心
        get().addMessage({ type: 'success', title, content });
      },
      
      showError: (title, content) => {
        toast.error(title, {
          description: content,
          duration: 6000, // 错误消息显示更久
        });
        get().addMessage({ type: 'error', title, content });
      },
      
      showWarning: (title, content) => {
        toast.warning(title, {
          description: content,
          duration: 5000,
        });
        get().addMessage({ type: 'warning', title, content });
      },
      
      showInfo: (title, content) => {
        toast.info(title, {
          description: content,
        });
        get().addMessage({ type: 'info', title, content });
      },
      
      // 视频处理相关方法
      startVideoProcessing: (title) => {
        const id = get().addMessage({
          type: 'processing',
          title,
          content: '正在初始化视频处理...',
          persistent: true,
          progress: {
            stage: 'analyzing',
            progress: 0,
            message: '正在分析视频文件...'
          }
        });
        
        toast.loading(title, {
          description: '视频处理已开始',
          id: `processing_${id}`,
        });
        
        return id;
      },
      
      updateVideoProcessingProgress: (id, progress) => {
        get().updateMessage(id, {
          progress,
          content: progress.message,
        });
        
        // 更新toast
        toast.loading(`处理进度: ${progress.progress}%`, {
          description: progress.message,
          id: `processing_${id}`,
        });
      },
      
      completeVideoProcessing: (id, blob, filename, savedPath) => {
        const downloadHandler = blob
          ? async () => {
            const types = [{
              description: 'Video files',
              accept: {
                'video/mp4': ['.mp4'],
                'video/webm': ['.webm'],
              },
            }];
            await saveFile(blob, filename, types);
          }
          : undefined;

        const sizeText = blob
          ? `文件大小: ${(blob.size / 1024 / 1024).toFixed(2)} MB`
          : undefined;
        const pathText = savedPath ? `保存位置: ${savedPath}` : undefined;
        const content = [sizeText, pathText].filter(Boolean).join('\n') || '导出完成';

        get().updateMessage(id, {
          type: 'success',
          title: '视频处理完成',
          content,
          processingResult: { blob: blob ?? undefined, filename, savedPath },
          action: downloadHandler
            ? { label: '重新保存', handler: downloadHandler }
            : undefined,
          progress: {
            stage: 'complete',
            progress: 100,
            message: '处理完成',
          },
        });

        toast.success('视频处理完成', {
          description: savedPath ?? '视频已保存',
          id: `processing_${id}`,
          action: downloadHandler
            ? { label: '重新保存', onClick: downloadHandler }
            : undefined,
        });
      },
      
      errorVideoProcessing: (id, error) => {
        get().updateMessage(id, {
          type: 'error',
          title: '视频处理失败',
          content: error,
          progress: {
            stage: 'error',
            progress: 0,
            message: '处理失败',
            error
          }
        });
        
        toast.error('视频处理失败', {
          description: error,
          id: `processing_${id}`,
        });
      },
    }),
    {
      name: 'message-store',
    }
  )
);

// 独立的选择器，避免创建新对象引用
export const useMessages = () => useMessageStore(state => state.messages);
export const useUnreadCount = () => useMessageStore(state => state.unreadCount);

// 独立的动作选择器，避免创建新对象引用
export const useAddMessage = () => useMessageStore(state => state.addMessage);
export const useUpdateMessage = () => useMessageStore(state => state.updateMessage);
export const useMarkAsRead = () => useMessageStore(state => state.markAsRead);
export const useMarkAllAsRead = () => useMessageStore(state => state.markAllAsRead);
export const useRemoveMessage = () => useMessageStore(state => state.removeMessage);
export const useClearMessages = () => useMessageStore(state => state.clearMessages);
export const useShowSuccess = () => useMessageStore(state => state.showSuccess);
export const useShowError = () => useMessageStore(state => state.showError);
export const useShowWarning = () => useMessageStore(state => state.showWarning);
export const useShowInfo = () => useMessageStore(state => state.showInfo);

// 视频处理相关选择器
export const useStartVideoProcessing = () => useMessageStore(state => state.startVideoProcessing);
export const useUpdateVideoProcessingProgress = () => useMessageStore(state => state.updateVideoProcessingProgress);
export const useCompleteVideoProcessing = () => useMessageStore(state => state.completeVideoProcessing);
export const useErrorVideoProcessing = () => useMessageStore(state => state.errorVideoProcessing);