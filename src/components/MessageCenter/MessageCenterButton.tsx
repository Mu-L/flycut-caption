// 消息中心触发按钮组件
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Bell } from 'lucide-react';
import { useUnreadCount } from '@/stores/messageStore';
import { MessageCenter } from './MessageCenter';

export function MessageCenterButton() {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = useUnreadCount();

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative p-1.5 rounded-md transition-colors',
          'hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
          isOpen && 'bg-muted'
        )}
        title="消息中心"
      >
        <Bell className="h-3.5 w-3.5 text-foreground" />
        
        {/* 未读计数徽章 */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground text-[10px] font-medium rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      
      <MessageCenter 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
      />
    </>
  );
}
