// 原语言编辑器 - 字词级标注/删除（需模型支持字词时间戳）
// 编辑期只维护文案与超阈值空白位，与播放器/时间轴无交互；确认后才写入 store

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  useChunks,
  useWordChunks,
  useHasWordTimestamps,
  useHistoryLanguage,
  useConfirmOriginalEditorMarks,
} from '@/stores/historyStore';
import { useAppStore } from '@/stores/appStore';
import { canDeleteByWordAtRuntime } from '@/utils/wordLevelEdit';
import {
  buildOriginalEditorSegments,
  getSegmentRangeIds,
  groupSegmentsIntoRows,
  planOriginalEditorConfirm,
  type OriginalEditorRow,
  type OriginalEditorSegment,
} from '@/utils/originalEditorSegments';
import { Highlighter, Strikethrough, Check, RotateCcw, ListChecks, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LocaleProvider';

export type OriginalSubtitleMode = 'mark' | 'delete';

interface OriginalEditorProps {
  className?: string;
  isASRLoading?: boolean;
}

interface SegmentSpanProps {
  segment: OriginalEditorSegment;
  blankLabel: string;
  mode: OriginalSubtitleMode;
  isMarked: boolean;
  isDragPreview: boolean;
  onPointerDown: (id: string) => void;
  onPointerEnter: (id: string) => void;
  onClick: (id: string, shiftKey: boolean) => void;
}

function SegmentSpan({
  segment,
  blankLabel,
  mode,
  isMarked,
  isDragPreview,
  onPointerDown,
  onPointerEnter,
  onClick,
}: SegmentSpanProps) {
  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      onPointerDown(segment.id);
    },
    onPointerEnter: () => onPointerEnter(segment.id),
    onClick: (event: React.MouseEvent) => {
      event.preventDefault();
      onClick(segment.id, event.shiftKey);
    },
  };

  if (segment.type === 'gap') {
    return (
      <span
        {...handlers}
        role="button"
        tabIndex={-1}
        className={cn(
          'inline-flex items-center mx-0.5 px-2 text-sm font-mono leading-none rounded-full border align-middle cursor-pointer',
          'border-dashed border-aimu-border text-aimu-text-muted bg-aimu-input/60',
          segment.deleted && 'opacity-50',
          isDragPreview && 'outline outline-1 outline-aimu-purple/40',
          isMarked && mode === 'mark' && 'border-aimu-purple bg-aimu-purple/25 text-aimu-purple',
          isMarked && mode === 'delete' && 'border-aimu-coral bg-aimu-coral/20 text-aimu-coral line-through',
        )}
      >
        {blankLabel}
      </span>
    );
  }

  return (
    <span
      {...handlers}
      role="button"
      tabIndex={-1}
      className={cn(
        'inline cursor-pointer rounded-sm px-0.5',
        segment.deleted
          ? 'text-aimu-text-muted line-through opacity-60'
          : 'text-aimu-text-secondary hover:bg-aimu-hover',
        isDragPreview && 'outline outline-1 outline-aimu-purple/40',
        isMarked && mode === 'mark' && 'bg-aimu-purple/30 text-aimu-text-primary',
        isMarked && mode === 'delete' && 'bg-aimu-coral/15 text-aimu-coral line-through',
      )}
    >
      {segment.text}
    </span>
  );
}

function SegmentRow({
  row,
  blankLabelFor,
  mode,
  markedIds,
  dragPreviewIds,
  onPointerDown,
  onPointerEnter,
  onClick,
}: {
  row: OriginalEditorRow;
  blankLabelFor: (duration: number) => string;
  mode: OriginalSubtitleMode;
  markedIds: Set<string>;
  dragPreviewIds: Set<string>;
  onPointerDown: (id: string) => void;
  onPointerEnter: (id: string) => void;
  onClick: (id: string, shiftKey: boolean) => void;
}) {
  return (
    <div className="min-h-8">
      {row.segments.map((segment) => (
        <SegmentSpan
          key={segment.id}
          segment={segment}
          blankLabel={blankLabelFor(segment.type === 'gap' ? segment.duration : 0)}
          mode={mode}
          isMarked={markedIds.has(segment.id)}
          isDragPreview={dragPreviewIds.has(segment.id)}
          onPointerDown={onPointerDown}
          onPointerEnter={onPointerEnter}
          onClick={onClick}
        />
      ))}
    </div>
  );
}

export function OriginalEditor({
  className,
  isASRLoading,
}: OriginalEditorProps) {
  const { t } = useTranslation();
  const chunks = useChunks();
  const wordChunks = useWordChunks();
  const hasWordTimestamps = useHasWordTimestamps();
  const language = useHistoryLanguage();
  const smartCutSilenceThreshold = useAppStore((state) => state.smartCutSilenceThreshold);
  const videoDuration = useAppStore((state) => state.videoPlayerState.duration);
  const confirmOriginalEditorMarks = useConfirmOriginalEditorMarks();

  const [mode, setMode] = useState<OriginalSubtitleMode>('mark');
  const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());
  const [dragPreviewIds, setDragPreviewIds] = useState<Set<string>>(() => new Set());

  const dragAnchorRef = useRef<string | null>(null);
  const dragEndRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const lastClickedIdRef = useRef<string | null>(null);

  const wordLevelReady = canDeleteByWordAtRuntime({ hasWordTimestamps, wordChunks });

  const segments = useMemo(
    () => (wordLevelReady
      ? buildOriginalEditorSegments(wordChunks, chunks, smartCutSilenceThreshold, videoDuration)
      : []),
    [wordLevelReady, wordChunks, chunks, smartCutSilenceThreshold, videoDuration],
  );

  const rows = useMemo(() => groupSegmentsIntoRows(segments), [segments]);

  const blankLabelFor = useCallback((duration: number) => (
    `${duration.toFixed(1)}s`
  ), []);

  const applyRangeMark = useCallback((fromId: string, toId: string, additive: boolean) => {
    const rangeIds = getSegmentRangeIds(segments, fromId, toId);
    setMarkedIds((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      for (const id of rangeIds) next.add(id);
      return next;
    });
  }, [segments]);

  const updateDragPreview = useCallback((anchorId: string, endId: string) => {
    const rangeIds = getSegmentRangeIds(segments, anchorId, endId);
    setDragPreviewIds(new Set(rangeIds));
  }, [segments]);

  const handleSegmentPointerDown = useCallback((id: string) => {
    isDraggingRef.current = true;
    didDragRef.current = false;
    dragAnchorRef.current = id;
    dragEndRef.current = id;
    updateDragPreview(id, id);
  }, [updateDragPreview]);

  const handleSegmentPointerEnter = useCallback((id: string) => {
    const anchor = dragAnchorRef.current;
    if (!isDraggingRef.current || !anchor) return;
    dragEndRef.current = id;
    if (id !== anchor) didDragRef.current = true;
    updateDragPreview(anchor, id);
  }, [updateDragPreview]);

  const handleSegmentClick = useCallback((id: string, shiftKey: boolean) => {
    if (didDragRef.current) return;

    if (shiftKey && lastClickedIdRef.current) {
      applyRangeMark(lastClickedIdRef.current, id, false);
    } else {
      setMarkedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastClickedIdRef.current = id;
  }, [applyRangeMark]);

  const handlePointerUp = useCallback(() => {
    if (
      isDraggingRef.current
      && didDragRef.current
      && dragAnchorRef.current
      && dragEndRef.current
    ) {
      applyRangeMark(dragAnchorRef.current, dragEndRef.current, true);
    }
    isDraggingRef.current = false;
    dragAnchorRef.current = null;
    dragEndRef.current = null;
    didDragRef.current = false;
    setDragPreviewIds(new Set());
  }, [applyRangeMark]);

  const handleSelectAll = useCallback(() => {
    setMarkedIds(new Set(segments.map((segment) => segment.id)));
  }, [segments]);

  const handleClearMarks = useCallback(() => {
    setMarkedIds(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    try {
      const plan = planOriginalEditorConfirm(
        segments,
        markedIds,
        mode,
        wordChunks,
        videoDuration,
      );
      const changedWords = plan.wordUpdates.length;
      const changedBlanks = plan.blankInserts.length + plan.blankUpdates.length;
      if (changedWords === 0 && changedBlanks === 0) {
        toast.info(t('components.workstation.originalNoChanges'));
        return;
      }
      confirmOriginalEditorMarks(plan);
      setMarkedIds(new Set());
      toast.success(
        t('components.workstation.originalConfirmDone')
          .replace('{words}', String(changedWords))
          .replace('{blanks}', String(changedBlanks)),
      );
    } catch (error) {
      console.error('原语言字幕确认失败:', error);
      const detail = error instanceof Error ? error.message : t('common.error');
      toast.error(t('messages.subtitle.originalConfirmFailed'), { description: detail });
    }
  }, [segments, markedIds, mode, wordChunks, videoDuration, confirmOriginalEditorMarks, t]);

  useEffect(() => {
    setMarkedIds(new Set());
    setDragPreviewIds(new Set());
  }, [segments]);

  if (isASRLoading) {
    return (
      <div className={cn('flex flex-col h-full bg-aimu-panel', className)}>
        <div className="flex-1 flex items-center justify-center text-aimu-text-muted text-sm">
          {t('messages.asr.asrStarted')}
        </div>
      </div>
    );
  }

  if (!wordLevelReady) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-8 bg-aimu-panel h-full text-center', className)}>
        <AlertCircle className="h-8 w-8 text-amber-500" />
        <p className="text-sm text-aimu-text-primary font-medium">
          {t('components.workstation.originalWordLevelRequired')}
        </p>
        <p className="text-xs text-aimu-text-muted max-w-sm">
          {t('components.workstation.originalWordLevelHint')}
        </p>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center p-8 bg-aimu-panel h-full', className)}>
        <p className="text-aimu-text-muted text-center">{t('components.fileUpload.noFileSelected')}</p>
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-col h-full bg-aimu-panel select-none', className)}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="flex items-center justify-between h-10 px-3 border-b border-aimu-border shrink-0">
        <div className="flex items-center bg-aimu-input rounded p-0.5">
          <button
            type="button"
            onClick={() => setMode('mark')}
            className={cn(
              'flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors',
              mode === 'mark'
                ? 'bg-aimu-purple text-white'
                : 'text-aimu-text-secondary hover:text-aimu-text-primary',
            )}
          >
            <Highlighter className="w-3 h-3" />
            {t('components.workstation.markMode')}
          </button>
          <button
            type="button"
            onClick={() => setMode('delete')}
            className={cn(
              'flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors',
              mode === 'delete'
                ? 'bg-aimu-coral text-white'
                : 'text-aimu-text-secondary hover:text-aimu-text-primary',
            )}
          >
            <Strikethrough className="w-3 h-3" />
            {t('components.workstation.deleteMode')}
          </button>
        </div>
        <span className="text-[10px] text-aimu-text-muted font-mono uppercase">{language}</span>
      </div>

      <div className={cn(
        'px-3 py-1.5 text-[11px] border-b border-aimu-border shrink-0',
        mode === 'mark' ? 'text-aimu-purple' : 'text-aimu-coral',
      )}>
        {mode === 'mark'
          ? t('components.workstation.markHintWordLevel')
          : t('components.workstation.deleteHintWordLevel')}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-sm leading-8 break-words">
          {rows.map((row) => (
            <SegmentRow
              key={row.id}
              row={row}
              blankLabelFor={blankLabelFor}
              mode={mode}
              markedIds={markedIds}
              dragPreviewIds={dragPreviewIds}
              onPointerDown={handleSegmentPointerDown}
              onPointerEnter={handleSegmentPointerEnter}
              onClick={handleSegmentClick}
            />
          ))}
        </div>
        <p className="mt-4 text-[10px] text-aimu-text-muted">
          {t('components.workstation.originalSelectHint')}
        </p>
      </div>

      <div className="flex items-center justify-between p-2 border-t border-aimu-border bg-aimu-panel shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSelectAll}
            className="flex items-center gap-1 px-2 py-1 text-xs text-aimu-text-secondary hover:text-aimu-text-primary transition-colors"
          >
            <ListChecks className="w-3.5 h-3.5" />
            {t('components.workstation.selectAllOriginal')}
          </button>
          <button
            type="button"
            onClick={handleClearMarks}
            disabled={markedIds.size === 0}
            className="flex items-center gap-1 px-2 py-1 text-xs text-aimu-text-secondary hover:text-aimu-text-primary transition-colors disabled:opacity-30"
          >
            <RotateCcw className="w-3.5 w-3.5" />
            {t('components.workstation.clearMarks')}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-aimu-text-muted font-mono">
            {t('components.workstation.markedCount')}: {markedIds.size}
          </span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={markedIds.size === 0}
            className={cn(
              'flex items-center gap-1 px-3 py-1 text-xs font-medium rounded transition-colors disabled:opacity-30',
              mode === 'mark'
                ? 'bg-aimu-purple text-white hover:bg-aimu-purple/90'
                : 'bg-aimu-coral text-white hover:bg-aimu-coral/90',
            )}
          >
            <Check className="w-3.5 h-3.5" />
            {mode === 'mark'
              ? t('components.workstation.confirmSelection')
              : t('components.workstation.confirmDeletion')}
          </button>
        </div>
      </div>
    </div>
  );
}