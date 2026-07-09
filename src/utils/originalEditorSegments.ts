import type { SubtitleChunk } from '@/types/subtitle';
import { calculateBlankSegments } from '@/utils/timeUtils';

export type OriginalEditorSegment =
  | {
      type: 'word';
      id: string;
      text: string;
      deleted?: boolean;
      sentenceId?: string;
    }
  | {
      type: 'gap';
      id: string;
      duration: number;
      deleted?: boolean;
      persisted: boolean;
      anchorWordId: string;
      position: 'before' | 'after';
    };

export function gapId(anchorWordId: string, position: 'before' | 'after') {
  return position === 'before' ? `gap-before-${anchorWordId}` : `gap-after-${anchorWordId}`;
}

function blankId(start: number, end: number) {
  return `blank-${start.toFixed(3)}-${end.toFixed(3)}`;
}

function approxEqual(a: number, b: number, epsilon = 0.001) {
  return Math.abs(a - b) < epsilon;
}

/** 确认时将空白位解析为时间区间（编辑期不暴露时间戳） */
export function resolveGapTimestamp(
  anchorWordId: string,
  position: 'before' | 'after',
  wordChunks: SubtitleChunk[],
  totalDuration?: number,
): [number, number] | null {
  const words = [...wordChunks]
    .filter((word) => !word.deleted)
    .sort((a, b) => a.timestamp[0] - b.timestamp[0]);
  if (words.length === 0) return null;

  const index = words.findIndex((word) => word.id === anchorWordId);
  if (index === -1) return null;

  if (position === 'before') {
    if (index !== 0) return null;
    return [0, words[0].timestamp[0]];
  }

  const word = words[index];
  if (index < words.length - 1) {
    return [word.timestamp[1], words[index + 1].timestamp[0]];
  }
  if (totalDuration !== undefined && isFinite(totalDuration)) {
    return [word.timestamp[1], totalDuration];
  }
  return null;
}

/**
 * 构建原语言编辑序列：按字词顺序排列，仅在超过阈值的静音处插入空白位。
 * 编辑期只关心文案与间隔位置，时间戳在确认时再解析。
 * 已删除内容（字词本身 deleted，或所属句子 deleted）会带上 deleted 标记，用于删除线展示。
 */
export function buildOriginalEditorSegments(
  wordChunks: SubtitleChunk[],
  sentenceChunks: SubtitleChunk[],
  threshold: number,
  totalDuration?: number,
): OriginalEditorSegment[] {
  const words = [...wordChunks].sort((a, b) => a.timestamp[0] - b.timestamp[0]);
  if (words.length === 0) return [];

  const deletedSentenceIds = new Set(
    sentenceChunks
      .filter((chunk) => !chunk.isBlankSpacer && chunk.deleted)
      .map((chunk) => chunk.id),
  );

  const isWordDeleted = (word: SubtitleChunk) =>
    Boolean(word.deleted) || Boolean(word.sentenceId && deletedSentenceIds.has(word.sentenceId));

  // 空白段仍按「未删除字词」计算，但已删除字词本身会保留在序列中以显示删除线
  const activeWords = words.filter((word) => !isWordDeleted(word));
  const blankSpacers = sentenceChunks.filter((chunk) => chunk.isBlankSpacer);
  const spacerMap = new Map(blankSpacers.map((chunk) => [chunk.id, chunk]));

  const gapRanges = activeWords.length > 0
    ? calculateBlankSegments(activeWords, threshold, totalDuration)
    : [];

  const gapBeforeFirst = gapRanges.find((gap) => approxEqual(gap.start, 0));
  const gapsAfterWord = new Map<string, { start: number; end: number }>();

  for (const gap of gapRanges) {
    if (gapBeforeFirst && gap === gapBeforeFirst) continue;

    const anchor = activeWords.find((word) => approxEqual(word.timestamp[1], gap.start));
    if (anchor) {
      gapsAfterWord.set(anchor.id, gap);
    }
  }

  const segments: OriginalEditorSegment[] = [];
  let emittedLeadingGap = false;
  const firstActiveId = activeWords[0]?.id;

  for (const word of words) {
    if (!emittedLeadingGap && gapBeforeFirst && firstActiveId && word.id === firstActiveId) {
      const anchorId = firstActiveId;
      const persisted = spacerMap.get(blankId(gapBeforeFirst.start, gapBeforeFirst.end));
      segments.push({
        type: 'gap',
        id: gapId(anchorId, 'before'),
        duration: gapBeforeFirst.end - gapBeforeFirst.start,
        deleted: persisted?.deleted,
        persisted: Boolean(persisted),
        anchorWordId: anchorId,
        position: 'before',
      });
      emittedLeadingGap = true;
    }

    segments.push({
      type: 'word',
      id: word.id,
      text: word.text,
      deleted: isWordDeleted(word),
      sentenceId: word.sentenceId,
    });

    const gapAfter = gapsAfterWord.get(word.id);
    if (gapAfter) {
      const persisted = spacerMap.get(blankId(gapAfter.start, gapAfter.end));
      segments.push({
        type: 'gap',
        id: gapId(word.id, 'after'),
        duration: gapAfter.end - gapAfter.start,
        deleted: persisted?.deleted,
        persisted: Boolean(persisted),
        anchorWordId: word.id,
        position: 'after',
      });
    }
  }

  return segments;
}

export interface OriginalEditorRow {
  id: string;
  segments: OriginalEditorSegment[];
}

const MAX_SEGMENTS_PER_ROW = 96;

/** 按句子（或固定上限）分行，供虚拟滚动渲染 */
export function groupSegmentsIntoRows(segments: OriginalEditorSegment[]): OriginalEditorRow[] {
  if (segments.length === 0) return [];

  const rows: OriginalEditorRow[] = [];
  let bucket: OriginalEditorSegment[] = [];
  let bucketSentenceId: string | undefined;
  let rowIndex = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    rows.push({ id: `row-${rowIndex++}`, segments: bucket });
    bucket = [];
    bucketSentenceId = undefined;
  };

  for (const segment of segments) {
    const sentenceId = segment.type === 'word' ? segment.sentenceId : undefined;

    if (bucket.length > 0) {
      const sentenceChanged = sentenceId != null
        && bucketSentenceId != null
        && sentenceId !== bucketSentenceId;
      if (sentenceChanged || bucket.length >= MAX_SEGMENTS_PER_ROW) {
        flush();
      }
    }

    bucket.push(segment);
    if (sentenceId) bucketSentenceId = sentenceId;
  }

  flush();
  return rows;
}

export function getSegmentRangeIds(
  segments: OriginalEditorSegment[],
  fromId: string,
  toId: string,
): string[] {
  const fromIndex = segments.findIndex((segment) => segment.id === fromId);
  const toIndex = segments.findIndex((segment) => segment.id === toId);
  if (fromIndex === -1 || toIndex === -1) return [];
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return segments.slice(start, end + 1).map((segment) => segment.id);
}

export interface OriginalEditorConfirmPlan {
  wordUpdates: { id: string; deleted: boolean }[];
  blankInserts: { start: number; end: number }[];
  blankUpdates: { id: string; deleted: boolean }[];
}

/**
 * 根据标注/删除模式与标记集合，生成字词与空白段的删除计划（空白时间戳在确认时解析）。
 * - mark：仅保留标记项（未标记 → 删除；标记 → 恢复/保留）
 * - delete：仅对标记项执行删除（不自动恢复未标记的已删除项，避免误恢复）
 */
export function planOriginalEditorConfirm(
  segments: OriginalEditorSegment[],
  markedIds: Set<string>,
  mode: 'mark' | 'delete',
  wordChunks: SubtitleChunk[],
  totalDuration?: number,
): OriginalEditorConfirmPlan {
  const wordUpdates: { id: string; deleted: boolean }[] = [];
  const blankInserts: { start: number; end: number }[] = [];
  const blankUpdates: { id: string; deleted: boolean }[] = [];

  for (const segment of segments) {
    const isMarked = markedIds.has(segment.id);

    if (segment.type === 'word') {
      // 以 wordChunks 真实状态为准（展示态可能来自句子级删除）
      const word = wordChunks.find((item) => item.id === segment.id);
      const actualDeleted = Boolean(word?.deleted);

      if (mode === 'delete') {
        // 删除模式：只把标记项标为删除，不动其余已删除/未删除状态
        if (isMarked && !actualDeleted) {
          wordUpdates.push({ id: segment.id, deleted: true });
        }
      } else {
        // 标注模式：标记 = 保留，未标记 = 删除
        const deleted = !isMarked;
        if (actualDeleted !== deleted) {
          wordUpdates.push({ id: segment.id, deleted });
        }
      }
      continue;
    }

    const timestamp = resolveGapTimestamp(
      segment.anchorWordId,
      segment.position,
      wordChunks,
      totalDuration,
    );
    if (!timestamp) continue;

    const persistedId = blankId(timestamp[0], timestamp[1]);

    if (mode === 'delete') {
      if (!isMarked) continue;
      if (segment.persisted) {
        if (segment.deleted !== true) {
          blankUpdates.push({ id: persistedId, deleted: true });
        }
      } else {
        blankInserts.push({ start: timestamp[0], end: timestamp[1] });
      }
      continue;
    }

    // mark 模式
    const shouldCut = !isMarked;
    if (shouldCut) {
      if (segment.persisted) {
        if (segment.deleted !== true) {
          blankUpdates.push({ id: persistedId, deleted: true });
        }
      } else {
        blankInserts.push({ start: timestamp[0], end: timestamp[1] });
      }
    } else if (segment.persisted && segment.deleted) {
      blankUpdates.push({ id: persistedId, deleted: false });
    }
  }

  return { wordUpdates, blankInserts, blankUpdates };
}