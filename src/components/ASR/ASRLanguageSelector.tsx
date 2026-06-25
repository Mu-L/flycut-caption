// ASR 语言选择器组件 - 专用于语音识别语言选择
// 支持 Whisper 模型的所有语言，带搜索和分组功能

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { WHISPER_LANGUAGES, getLanguageName } from '@/constants/languages';
import { Globe, Search, Check, ChevronDown } from 'lucide-react';

interface ASRLanguageSelectorProps {
  language: string;
  onLanguageChange: (language: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function ASRLanguageSelector({
  language,
  onLanguageChange,
  disabled = false,
  className,
  placeholder = '搜索语音识别语言...'
}: ASRLanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 过滤和排序语言选项
  const filteredLanguages = useMemo(() => {
    const allLanguages = Object.entries(WHISPER_LANGUAGES).map(([code, name]) => ({
      code,
      name
    }));

    if (!searchTerm) {
      // 没有搜索词时，按常用程度排序
      const commonOrder = ['en', 'zh', 'ja', 'ko', 'fr', 'es', 'de', 'ru', 'it', 'pt'];
      return allLanguages.sort((a, b) => {
        const aIndex = commonOrder.indexOf(a.code);
        const bIndex = commonOrder.indexOf(b.code);
        
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        
        return a.name.localeCompare(b.name);
      });
    }

    // 按搜索词过滤
    return allLanguages.filter(lang => 
      lang.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lang.code.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => {
      // 优先显示以搜索词开头的项目
      const aStartsWith = a.name.toLowerCase().startsWith(searchTerm.toLowerCase());
      const bStartsWith = b.name.toLowerCase().startsWith(searchTerm.toLowerCase());
      
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;
      
      return a.name.localeCompare(b.name);
    });
  }, [searchTerm]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleOpen = useCallback(() => {
    if (!disabled) {
      setIsOpen(!isOpen);
      if (!isOpen) {
        // 打开时聚焦搜索框
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [disabled, isOpen]);

  const handleLanguageSelect = useCallback((selectedLanguage: string) => {
    onLanguageChange(selectedLanguage);
    setIsOpen(false);
    setSearchTerm('');
  }, [onLanguageChange]);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  }, []);

  const currentLanguageName = getLanguageName(language);

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      {/* 选择器触发按钮 */}
      <button
        type="button"
        onClick={handleToggleOpen}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2',
          'border border-gray-300 dark:border-gray-600 rounded-md',
          'bg-background text-foreground',
          'hover:bg-gray-50 dark:hover:bg-gray-700',
          'focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors duration-200',
          {
            'ring-2 ring-blue-500 border-blue-500': isOpen,
          }
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-left break-words leading-tight">{currentLanguageName}</span>
        </div>
        
        <ChevronDown 
          className={cn(
            'w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0',
            { 'rotate-180': isOpen }
          )} 
        />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className={cn(
          'absolute top-full left-0 right-0 z-50 mt-1',
          'bg-popover border border-border',
          'rounded-md shadow-lg max-h-80 overflow-hidden',
          'animate-in fade-in-0 zoom-in-95 duration-200'
        )}>
          {/* 搜索框 */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder={placeholder}
                className={cn(
                  'w-full pl-10 pr-3 py-2 text-sm',
                  'bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600',
                  'rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                  'placeholder-gray-400 dark:placeholder-gray-500'
                )}
              />
            </div>
          </div>

          {/* 语言选项列表 */}
          <div className="max-h-60 overflow-y-auto">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map(({ code, name }) => (
                <button
                  key={code}
                  onClick={() => handleLanguageSelect(code)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 text-left',
                    'hover:bg-gray-50 dark:hover:bg-gray-700',
                    'focus:bg-gray-50 dark:focus:bg-gray-700',
                    'transition-colors duration-150',
                    {
                      'bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400': code === language,
                    }
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground w-6 flex-shrink-0">
                      {code}
                    </span>
                    <span className="truncate">{name}</span>
                  </div>
                  
                  {code === language && (
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm">未找到匹配的语言</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}