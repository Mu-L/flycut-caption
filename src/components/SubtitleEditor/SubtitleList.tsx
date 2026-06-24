// 字幕列表组件

import { useMemo, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useHistoryStore, useChunks, useHistoryText, useHistoryLanguage, useHistoryDuration, useCanUndo, useCanRedo, useUndo, useRedo } from '@/stores/historyStore';
import { useAppStore } from '@/stores/appStore';
import { isTimeInRange } from '@/utils/timeUtils';
import { FileText, Trash2, RotateCcw, Undo, Redo, ArrowLeftRight, Languages } from 'lucide-react';
import { SubtitleItem } from './SubtitleItem';
import type { EnhancedVideoPlayerRef } from '@/components/VideoPlayer/EnhancedVideoPlayer';
import { useTranslation } from '@/contexts/LocaleProvider';

interface SubtitleListProps {
  className?: string;
  currentTime?: number;
  isPlaying?: boolean;
  onSeek?: (time: number) => void;
  onPlayPause?: () => void;
  videoPlayerRef?: RefObject<EnhancedVideoPlayerRef>;
}

export function SubtitleList({
  className,
  videoPlayerRef
}: SubtitleListProps) {
  const { t } = useTranslation();
  const chunks = useChunks();
  const text = useHistoryText();
  const language = useHistoryLanguage();
  const duration = useHistoryDuration();
  
  // 历史记录操作
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const undo = useUndo();
  const redo = useRedo();
  
  const transcript = useMemo(() => ({
    text,
    chunks,
    language,
    duration,
  }), [text, chunks, language, duration]);
  
  const activeChunks = useMemo(
    () => chunks.filter(c => !c.deleted),
    [chunks]
  );
  
  const currentTime = useAppStore(state => state.currentTime);
  const displayMode = useAppStore(state => state.display);
  const setDisplayMode = useAppStore(state => state.setDisplay);
  
  const deleteSelected = useHistoryStore(state => state.deleteSelected);
  const restoreSelected = useHistoryStore(state => state.restoreSelected);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const seekTo = (time: number) => {
    if (videoPlayerRef?.current) {
      videoPlayerRef.current.seekTo(time);
    }
  };

  const currentChunk = useMemo(() => {
    return transcript.chunks.find(chunk =>
      isTimeInRange(currentTime, chunk.timestamp)
    ) || null;
  }, [transcript.chunks, currentTime]);

  const statistics = useMemo(() => {
    const deletedChunks = transcript.chunks.filter(chunk => chunk.deleted);
    const activeCount = activeChunks.length;
    const deletedCount = deletedChunks.length;
    const totalCount = transcript.chunks.length;

    return {
      totalCount,
      activeCount,
      deletedCount,
    };
  }, [transcript.chunks, activeChunks]);

  const handleToggleSelection = (chunkId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(chunkId)) {
      newSelected.delete(chunkId);
    } else {
      newSelected.add(chunkId);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size > 0) {
      deleteSelected(selectedIds);
      setSelectedIds(new Set());
    }
  };

  const handleSelectAll = () => {
    const allActiveIds = new Set(activeChunks.map(chunk => chunk.id));
    setSelectedIds(allActiveIds);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleRestoreDeleted = () => {
    const deletedIds = new Set(
      transcript.chunks
        .filter(chunk => chunk.deleted)
        .map(chunk => chunk.id)
    );
    if (deletedIds.size > 0) {
      restoreSelected(deletedIds);
    }
  };

  if (!transcript.chunks || transcript.chunks.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center p-8 bg-aimu-panel h-full', className)}>
        <FileText className="h-12 w-12 text-aimu-text-muted mb-4" />
        <p className="text-aimu-text-muted text-center">
          {t('components.fileUpload.noFileSelected')}
          <br />
          {t('components.fileUpload.dragDropText')}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-aimu-panel', className)}>
      {/* Panel Header (~40px tall, border-bottom) */}
      <div className="flex items-center justify-between h-10 px-3 border-b border-aimu-border shrink-0">
        {/* LEFT: Display mode segmented control */}
        <div className="flex items-center bg-aimu-input rounded p-0.5">
          <button
            onClick={() => setDisplayMode('Bilingual')}
            className={cn(
              'px-3 py-1 text-xs rounded transition-colors',
              displayMode === 'Bilingual' 
                ? 'bg-aimu-purple text-white' 
                : 'text-aimu-text-secondary hover:text-aimu-text-primary'
            )}
          >
            {t('components.workstation.displayBilingual')}
          </button>
          <button
            onClick={() => setDisplayMode('Main')}
            className={cn(
              'px-3 py-1 text-xs rounded transition-colors',
              displayMode === 'Main' 
                ? 'bg-aimu-purple text-white' 
                : 'text-aimu-text-secondary hover:text-aimu-text-primary'
            )}
          >
            {t('components.workstation.displayMain')}
          </button>
          <button
            onClick={() => setDisplayMode('Second')}
            className={cn(
              'px-3 py-1 text-xs rounded transition-colors',
              displayMode === 'Second' 
                ? 'bg-aimu-purple text-white' 
                : 'text-aimu-text-secondary hover:text-aimu-text-primary'
            )}
          >
            {t('components.workstation.displaySecond')}
          </button>
        </div>

        {/* CENTER: Swap button */}
        <button className="p-1.5 text-aimu-text-muted hover:text-aimu-text-primary transition-colors rounded" title={t('components.workstation.swapTitle')}>
          <ArrowLeftRight className="w-4 h-4" />
        </button>

        {/* RIGHT: Translation language dropdown + Start button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-2 py-1 border border-aimu-border rounded text-xs text-aimu-text-secondary cursor-not-allowed opacity-70">
            <Languages className="w-3.5 h-3.5" />
            <span>{t('components.languageSelector.selectLanguage')}</span>
          </div>
          <button disabled className="px-3 py-1 text-xs bg-aimu-red-bg text-aimu-coral rounded opacity-50 cursor-not-allowed font-medium">
            {t('components.workstation.start')}
          </button>
        </div>
      </div>

      {/* Subtitle List (scrollable) */}
      <div className="flex-1 overflow-y-auto">
        {transcript.chunks.map((chunk, index) => {
          const isActive = !chunk.deleted;
          const isCurrent = currentChunk?.id === chunk.id;
          const isSelected = selectedIds.has(chunk.id);
          
          return (
            <SubtitleItem
              key={chunk.id}
              chunk={chunk}
              index={index}
              isActive={isActive}
              isCurrent={isCurrent}
              isSelected={isSelected}
              onToggleSelection={handleToggleSelection}
              onSeekTo={seekTo}
            />
          );
        })}
      </div>

      {/* Status/toolbar area at the bottom */}
      <div className="flex items-center justify-between p-2 border-t border-aimu-border bg-aimu-panel shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 text-aimu-text-muted hover:text-aimu-text-primary disabled:opacity-30 transition-colors rounded"
            title={t('components.subtitleEditor.undoDelete')}
          >
            <Undo className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 text-aimu-text-muted hover:text-aimu-text-primary disabled:opacity-30 transition-colors rounded"
            title={t('components.subtitleEditor.redoDelete')}
          >
            <Redo className="w-4 h-4" />
          </button>
          
          <div className="w-px h-4 bg-aimu-border mx-1"></div>
          
          <button
            onClick={handleSelectAll}
            className="px-2 py-1 text-xs text-aimu-text-secondary hover:text-aimu-text-primary transition-colors"
          >
            {t('components.subtitleEditor.selectAll')}
          </button>
          <button
            onClick={handleClearSelection}
            className="px-2 py-1 text-xs text-aimu-text-secondary hover:text-aimu-text-primary transition-colors"
          >
            {t('components.subtitleEditor.clearSelection')}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-[11px] text-aimu-text-muted font-mono mr-2">
            {t('components.workstation.total')}: {statistics.totalCount} | {t('components.workstation.active')}: {statistics.activeCount}
          </div>
          
          <button
            onClick={handleDeleteSelected}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1 px-2 py-1 text-xs text-aimu-coral hover:bg-aimu-red-bg rounded disabled:opacity-30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('components.subtitleEditor.deleteSelected')} ({selectedIds.size})</span>
          </button>

          {statistics.deletedCount > 0 && (
            <button
              onClick={handleRestoreDeleted}
              className="flex items-center gap-1 px-2 py-1 text-xs text-green-500 hover:bg-green-500/10 rounded transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('components.workstation.restore')} ({statistics.deletedCount})</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
