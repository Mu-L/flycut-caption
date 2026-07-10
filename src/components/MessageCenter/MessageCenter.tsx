// 消息中心面板组件
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  useMessages, 
  useUnreadCount, 
  useMarkAsRead,
  useMarkAllAsRead,
  useRemoveMessage,
  useClearMessages
} from '@/stores/messageStore';
import { MessageCard } from './MessageCard';
import { 
  Bell, 
  BellOff, 
  CheckCheck, 
  Trash2, 
  Filter,
  Search,
  X 
} from 'lucide-react';
import type { MessageType } from '@/types/message';

interface MessageCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const filterOptions: { label: string; value: MessageType | 'all' }[] = [
  { label: '全部', value: 'all' },
  { label: '成功', value: 'success' },
  { label: '错误', value: 'error' },
  { label: '警告', value: 'warning' },
  { label: '信息', value: 'info' },
];

export function MessageCenter({ isOpen, onClose }: MessageCenterProps) {
  const messages = useMessages();
  const unreadCount = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const removeMessage = useRemoveMessage();
  const clearMessages = useClearMessages();
  
  const [filter, setFilter] = useState<MessageType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // 过滤消息
  const filteredMessages = messages.filter(message => {
    // 类型过滤
    if (filter !== 'all' && message.type !== filter) return false;
    
    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = message.title.toLowerCase().includes(query);
      const matchesContent = message.content?.toLowerCase().includes(query);
      if (!matchesTitle && !matchesContent) return false;
    }
    
    // 未读过滤
    if (showUnreadOnly && message.read) return false;
    
    return true;
  });

  const handleClearAll = () => {
    if (confirm('确定要清空所有消息吗？')) {
      clearMessages();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="fixed right-4 top-16 w-96 max-h-[calc(100vh-5rem)] bg-card rounded-lg shadow-2xl border flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="shrink-0 p-4 border-b flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">消息中心</h2>
            {unreadCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 搜索和过滤器 */}
        <div className="shrink-0 p-4 border-b space-y-3">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索消息..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          
          {/* 过滤器行 */}
          <div className="flex items-center justify-between">
            {/* 类型过滤 */}
            <div className="flex items-center space-x-1">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as MessageType | 'all')}
                className="text-sm border-none bg-transparent focus:outline-none"
              >
                {filterOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            
            {/* 未读过滤 */}
            <button
              onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              className={cn(
                'flex items-center space-x-1 px-2 py-1 rounded text-xs transition-colors',
                showUnreadOnly 
                  ? 'bg-primary text-primary-foreground' 
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <BellOff className="h-3 w-3" />
              <span>未读</span>
            </button>
          </div>
        </div>

        {/* 操作按钮 */}
        {messages.length > 0 && (
          <div className="shrink-0 p-4 border-b flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center space-x-1 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <CheckCheck className="h-4 w-4" />
                  <span>全部标记已读</span>
                </button>
              )}
            </div>
            
            <button
              onClick={handleClearAll}
              className="flex items-center space-x-1 text-sm text-destructive hover:text-destructive/80 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              <span>清空全部</span>
            </button>
          </div>
        )}

        {/* 消息列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredMessages.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">
                {messages.length === 0 
                  ? '暂无消息' 
                  : '没有符合条件的消息'
                }
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {filteredMessages.map(message => (
                <div key={message.id} className="group">
                  <MessageCard
                    message={message}
                    onMarkAsRead={markAsRead}
                    onRemove={removeMessage}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 底部统计 */}
        <div className="p-3 border-t text-xs text-muted-foreground text-center">
          共 {messages.length} 条消息
          {unreadCount > 0 && ` · ${unreadCount} 条未读`}
        </div>
      </div>
    </div>
  );
}