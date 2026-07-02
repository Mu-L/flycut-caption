// 字幕历史管理 Zustand Store
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SubtitleChunk, SubtitleTranscript } from '@/types/subtitle'
import { normalizeAsrTranscript } from '@/utils/asrTranscriptUtils'
import { logAsrModelOutput } from '@/utils/asrOutputLog'

type ChunkLayer = 'sentence' | 'word'

interface Chunk extends SubtitleChunk {
  deleted?: boolean;
}

interface UpdateAction {
  type: "update";
  layer: ChunkLayer;
  id: string;
  prev: Partial<Chunk>;
  next: Partial<Chunk>;
}

interface BatchUpdateAction {
  type: "batch";
  updates: { layer: ChunkLayer; id: string; prev: Partial<Chunk>; next: Partial<Chunk> }[];
}

interface InsertChunksAction {
  type: "insert";
  chunks: Chunk[]; // 被插入的占位 chunk（撤销时按 id 移除，重做时重新插入）
}

type HistoryAction = UpdateAction | BatchUpdateAction | InsertChunksAction;

interface HistoryState {
  // 字幕数据
  chunks: Chunk[];
  wordChunks: Chunk[];
  hasWordTimestamps: boolean;
  language: string;
  
  // 历史记录
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];
  lastUpdateTime: number;
  mergeThreshold: number; // 连续操作合并阈值（毫秒）

  // 衍生状态
  text: string; // 所有未删除chunks的text拼接
  duration: number; // 所有未删除chunks的总时长
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryActions {
  // 基础操作
  setTranscript: (transcript: SubtitleTranscript) => void;
  update: (id: string, next: Partial<Chunk>, layer?: ChunkLayer) => void;
  delete: (id: string) => void; // 封装的删除操作（句子级，级联字词）
  deleteWord: (id: string) => void; // 字词级删除/恢复
  
  // 历史操作
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  
  // 批量操作
  deleteSelected: (selectedIds: Set<string>) => void;
  restoreSelected: (selectedIds: Set<string>) => void;
  
  // 编辑字幕文本
  updateChunkText: (chunkId: string, newText: string) => void;

  // 批量更新多个 chunk 的 text/secondText（整批作为一次 undo）
  batchUpdateText: (updates: { id: string; text?: string; secondText?: string }[]) => void;

  // 智能剪切：插入空白占位 chunk（deleted:true），作为一次可撤销操作
  insertBlankChunks: (segments: { start: number; end: number }[]) => void;

  // 重置
  reset: () => void;
}

// 计算衍生状态的辅助函数
const computeDerivedState = (chunks: Chunk[]) => {
  const activeChunks = chunks.filter(chunk => !chunk.deleted);
  
  const text = activeChunks
    .sort((a, b) => a.timestamp[0] - b.timestamp[0])
    .map(chunk => chunk.text)
    .join(' ');
    
  const duration = activeChunks.reduce((total, chunk) => {
    return total + (chunk.timestamp[1] - chunk.timestamp[0]);
  }, 0);
  
  return { text, duration };
};

// 初始状态
const applyChunkUpdate = (
  chunks: Chunk[],
  wordChunks: Chunk[],
  layer: ChunkLayer,
  id: string,
  patch: Partial<Chunk>,
): { chunks: Chunk[]; wordChunks: Chunk[] } => {
  if (layer === 'word') {
    const index = wordChunks.findIndex((chunk) => chunk.id === id);
    if (index === -1) return { chunks, wordChunks };
    const nextWordChunks = [...wordChunks];
    nextWordChunks[index] = { ...nextWordChunks[index], ...patch };
    return { chunks, wordChunks: nextWordChunks };
  }

  const index = chunks.findIndex((chunk) => chunk.id === id);
  if (index === -1) return { chunks, wordChunks };
  const nextChunks = [...chunks];
  nextChunks[index] = { ...nextChunks[index], ...patch };
  return { chunks: nextChunks, wordChunks };
};

const syncSentenceFromWords = (chunks: Chunk[], wordChunks: Chunk[], sentenceId: string): Chunk[] => {
  const sentence = chunks.find((chunk) => chunk.id === sentenceId);
  if (!sentence?.wordIds?.length) return chunks;

  const words = sentence.wordIds
    .map((wordId) => wordChunks.find((word) => word.id === wordId))
    .filter((word): word is Chunk => Boolean(word));
  if (words.length === 0) return chunks;

  const allDeleted = words.every((word) => word.deleted);

  return chunks.map((chunk) =>
    chunk.id === sentenceId ? { ...chunk, deleted: allDeleted } : chunk,
  );
};

const initialState: HistoryState = {
  chunks: [],
  wordChunks: [],
  hasWordTimestamps: false,
  language: 'en',
  undoStack: [],
  redoStack: [],
  lastUpdateTime: 0,
  mergeThreshold: 500,
  text: '',
  duration: 0,
  canUndo: false,
  canRedo: false,
};

// 创建Store
export const useHistoryStore = create<HistoryState & HistoryActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // 设置字幕转录内容
      setTranscript: (transcript) => {
        logAsrModelOutput(transcript, {
          source: 'setTranscript',
          stage: '模型原始输出',
        });

        const normalized = normalizeAsrTranscript(transcript);

        logAsrModelOutput(normalized, {
          source: 'setTranscript',
          stage: '规范化后',
        });
        const chunks = normalized.chunks.map((chunk) => ({
          ...chunk,
          deleted: chunk.deleted ?? false,
        }));
        const wordChunks = (normalized.wordChunks ?? []).map((chunk) => ({
          ...chunk,
          deleted: chunk.deleted ?? false,
        }));
        const derived = computeDerivedState(chunks);

        set({
          chunks,
          wordChunks,
          hasWordTimestamps: normalized.hasWordTimestamps ?? false,
          language: normalized.language,
          text: derived.text,
          duration: derived.duration,
          undoStack: [],
          redoStack: [],
          canUndo: false,
          canRedo: false,
        });
      },

      // 更新 chunk 属性（句子或字词层）
      update: (id, next, layer = 'sentence') => {
        const state = get();
        const sourceChunks = layer === 'word' ? state.wordChunks : state.chunks;
        const chunk = sourceChunks.find((item) => item.id === id);
        if (!chunk) return;

        const prev: Partial<Chunk> = {};
        for (const key in next) {
          const k = key as keyof Chunk;
          prev[k] = chunk[k] as never;
        }

        const now = Date.now();
        const lastAction = state.undoStack[state.undoStack.length - 1];
        const applied = applyChunkUpdate(state.chunks, state.wordChunks, layer, id, next);
        let newChunks = applied.chunks;
        const newWordChunks = applied.wordChunks;

        if (layer === 'word' && chunk.sentenceId) {
          newChunks = syncSentenceFromWords(newChunks, newWordChunks, chunk.sentenceId);
        }

        let newUndoStack: HistoryAction[];
        const newRedoStack: HistoryAction[] = [];
        const newLastUpdateTime = now;

        if (
          lastAction &&
          lastAction.type === 'update' &&
          lastAction.layer === layer &&
          lastAction.id === id &&
          now - state.lastUpdateTime < state.mergeThreshold
        ) {
          const mergedAction = {
            ...lastAction,
            next: { ...lastAction.next, ...next },
          };
          newUndoStack = [...state.undoStack.slice(0, -1), mergedAction];
        } else {
          const action: UpdateAction = { type: 'update', layer, id, prev, next };
          newUndoStack = [...state.undoStack, action];
        }

        const derived = computeDerivedState(newChunks);

        set({
          chunks: newChunks,
          wordChunks: newWordChunks,
          undoStack: newUndoStack,
          redoStack: newRedoStack,
          lastUpdateTime: newLastUpdateTime,
          text: derived.text,
          duration: derived.duration,
          canUndo: newUndoStack.length > 0,
          canRedo: newRedoStack.length > 0,
        });
      },

      // 删除句子（有字词时级联到 wordChunks）
      delete: (id) => {
        const state = get();
        const chunk = state.chunks.find((item) => item.id === id);
        if (!chunk) return;

        const nextDeleted = !chunk.deleted;
        if (state.hasWordTimestamps && chunk.wordIds?.length) {
          const updates: BatchUpdateAction['updates'] = [
            {
              layer: 'sentence',
              id,
              prev: { deleted: chunk.deleted },
              next: { deleted: nextDeleted },
            },
          ];

          for (const wordId of chunk.wordIds) {
            const word = state.wordChunks.find((item) => item.id === wordId);
            if (!word) continue;
            updates.push({
              layer: 'word',
              id: wordId,
              prev: { deleted: word.deleted },
              next: { deleted: nextDeleted },
            });
          }

          let newChunks = [...state.chunks];
          let newWordChunks = [...state.wordChunks];
          for (const item of updates) {
            const applied = applyChunkUpdate(
              newChunks,
              newWordChunks,
              item.layer,
              item.id,
              item.next,
            );
            newChunks = applied.chunks;
            newWordChunks = applied.wordChunks;
          }

          const derived = computeDerivedState(newChunks);
          set({
            chunks: newChunks,
            wordChunks: newWordChunks,
            undoStack: [...state.undoStack, { type: 'batch', updates }],
            redoStack: [],
            text: derived.text,
            duration: derived.duration,
            canUndo: true,
            canRedo: false,
          });
          return;
        }

        get().update(id, { deleted: nextDeleted }, 'sentence');
      },

      deleteWord: (id) => {
        const state = get();
        const word = state.wordChunks.find((item) => item.id === id);
        if (!word) return;
        get().update(id, { deleted: !word.deleted }, 'word');
      },

      // 撤销操作
      undo: () => {
        const state = get();
        if (state.undoStack.length === 0) return;

        const action = state.undoStack[state.undoStack.length - 1];
        let newChunks = [...state.chunks];
        let newWordChunks = [...state.wordChunks];

        if (action.type === "update") {
          const applied = applyChunkUpdate(
            newChunks,
            newWordChunks,
            action.layer,
            action.id,
            action.prev,
          );
          newChunks = applied.chunks;
          newWordChunks = applied.wordChunks;
          if (action.layer === 'word') {
            const word = newWordChunks.find((item) => item.id === action.id);
            if (word?.sentenceId) {
              newChunks = syncSentenceFromWords(newChunks, newWordChunks, word.sentenceId);
            }
          }
        } else if (action.type === "batch") {
          for (const u of action.updates) {
            const applied = applyChunkUpdate(
              newChunks,
              newWordChunks,
              u.layer,
              u.id,
              u.prev,
            );
            newChunks = applied.chunks;
            newWordChunks = applied.wordChunks;
          }
        } else {
          // insert: 撤销时移除被插入的占位 chunk
          const insertedIds = new Set(action.chunks.map(c => c.id));
          for (let i = newChunks.length - 1; i >= 0; i--) {
            if (insertedIds.has(newChunks[i].id)) {
              newChunks.splice(i, 1);
            }
          }
        }

        // 移动到redo栈
        const newUndoStack = state.undoStack.slice(0, -1);
        const newRedoStack = [...state.redoStack, action];

        // 重新计算衍生状态
        const derived = computeDerivedState(newChunks);

        set({
          chunks: newChunks,
          wordChunks: newWordChunks,
          undoStack: newUndoStack,
          redoStack: newRedoStack,
          text: derived.text,
          duration: derived.duration,
          canUndo: newUndoStack.length > 0,
          canRedo: newRedoStack.length > 0,
        });
      },

      // 重做操作
      redo: () => {
        const state = get();
        if (state.redoStack.length === 0) return;

        const action = state.redoStack[state.redoStack.length - 1];
        let newChunks = [...state.chunks];
        let newWordChunks = [...state.wordChunks];

        if (action.type === "update") {
          const applied = applyChunkUpdate(
            newChunks,
            newWordChunks,
            action.layer,
            action.id,
            action.next,
          );
          newChunks = applied.chunks;
          newWordChunks = applied.wordChunks;
          if (action.layer === 'word') {
            const word = newWordChunks.find((item) => item.id === action.id);
            if (word?.sentenceId) {
              newChunks = syncSentenceFromWords(newChunks, newWordChunks, word.sentenceId);
            }
          }
        } else if (action.type === "batch") {
          for (const u of action.updates) {
            const applied = applyChunkUpdate(
              newChunks,
              newWordChunks,
              u.layer,
              u.id,
              u.next,
            );
            newChunks = applied.chunks;
            newWordChunks = applied.wordChunks;
          }
        } else {
          // insert: 重做时重新插入占位 chunk，按时间顺序合并
          const existingIds = new Set(newChunks.map(c => c.id));
          const toInsert = action.chunks.filter(c => !existingIds.has(c.id));
          if (toInsert.length > 0) {
            newChunks.push(...toInsert);
            newChunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);
          }
        }

        // 移动回undo栈
        const newUndoStack = [...state.undoStack, action];
        const newRedoStack = state.redoStack.slice(0, -1);

        // 重新计算衍生状态
        const derived = computeDerivedState(newChunks);

        set({
          chunks: newChunks,
          wordChunks: newWordChunks,
          undoStack: newUndoStack,
          redoStack: newRedoStack,
          text: derived.text,
          duration: derived.duration,
          canUndo: newUndoStack.length > 0,
          canRedo: newRedoStack.length > 0,
        });
      },

      // 清空历史记录
      clearHistory: () => {
        set({
          undoStack: [],
          redoStack: [],
          canUndo: false,
          canRedo: false,
        });
      },

      // 批量删除选中的chunks
      deleteSelected: (selectedIds) => {
        const state = get();
        const actions: UpdateAction[] = [];
        const newChunks = [...state.chunks];
        const now = Date.now();
        
        // 为每个选中的chunk创建删除操作
        for (const id of selectedIds) {
          const chunkIndex = newChunks.findIndex(c => c.id === id);
          if (chunkIndex !== -1) {
            const chunk = newChunks[chunkIndex];
            if (!chunk.deleted) {
              const action: UpdateAction = {
                type: "update",
                layer: 'sentence',
                id,
                prev: { deleted: chunk.deleted },
                next: { deleted: true }
              };
              
              newChunks[chunkIndex] = { ...chunk, deleted: true };
              actions.push(action);
            }
          }
        }
        
        if (actions.length > 0) {
          // 重新计算衍生状态
          const derived = computeDerivedState(newChunks);
          
          set({
            chunks: newChunks,
            undoStack: [...state.undoStack, ...actions],
            redoStack: [],
            lastUpdateTime: now,
            text: derived.text,
            duration: derived.duration,
            canUndo: true,
            canRedo: false,
          });
        }
      },

      // 批量恢复选中的chunks
      restoreSelected: (selectedIds) => {
        const state = get();
        const actions: UpdateAction[] = [];
        const newChunks = [...state.chunks];
        const now = Date.now();
        
        // 为每个选中的chunk创建恢复操作
        for (const id of selectedIds) {
          const chunkIndex = newChunks.findIndex(c => c.id === id);
          if (chunkIndex !== -1) {
            const chunk = newChunks[chunkIndex];
            if (chunk.deleted) {
              const action: UpdateAction = {
                type: "update",
                layer: 'sentence',
                id,
                prev: { deleted: chunk.deleted },
                next: { deleted: false }
              };
              
              newChunks[chunkIndex] = { ...chunk, deleted: false };
              actions.push(action);
            }
          }
        }
        
        if (actions.length > 0) {
          // 重新计算衍生状态
          const derived = computeDerivedState(newChunks);
          
          set({
            chunks: newChunks,
            undoStack: [...state.undoStack, ...actions],
            redoStack: [],
            lastUpdateTime: now,
            text: derived.text,
            duration: derived.duration,
            canUndo: true,
            canRedo: false,
          });
        }
      },

      // 编辑字幕文本
      updateChunkText: (chunkId, newText) => {
        const state = get();
        const newChunks = [...state.chunks];
        const now = Date.now();

        const chunkIndex = newChunks.findIndex(c => c.id === chunkId);
        if (chunkIndex === -1) {
          console.warn('找不到指定的字幕片段:', chunkId);
          return;
        }

        const chunk = newChunks[chunkIndex];
        const trimmedText = newText.trim();

        // 如果文本没有变化，不需要更新
        if (chunk.text === trimmedText) {
          return;
        }

        const action: UpdateAction = {
          type: "update",
          layer: 'sentence',
          id: chunkId,
          prev: { text: chunk.text },
          next: { text: trimmedText }
        };

        // 更新chunk文本
        newChunks[chunkIndex] = { ...chunk, text: trimmedText };

        // 重新计算衍生状态
        const derived = computeDerivedState(newChunks);

        set({
          chunks: newChunks,
          undoStack: [...state.undoStack, action],
          redoStack: [],
          lastUpdateTime: now,
          text: derived.text,
          duration: derived.duration,
          canUndo: true,
          canRedo: false,
        });
      },

      // 批量更新多个 chunk 的 text/secondText（整批作为一次 undo）
      batchUpdateText: (updates) => {
        const state = get();
        if (updates.length === 0) return;
        const newChunks = [...state.chunks];
        const now = Date.now();
        const batchUpdates: BatchUpdateAction['updates'] = [];

        for (const u of updates) {
          const chunkIndex = newChunks.findIndex(c => c.id === u.id);
          if (chunkIndex === -1) continue;
          const chunk = newChunks[chunkIndex];
          const next: Partial<Chunk> = {};
          const prev: Partial<Chunk> = {};
          if (u.text !== undefined && u.text !== chunk.text) {
            next.text = u.text;
            prev.text = chunk.text;
          }
          if (u.secondText !== undefined && u.secondText !== chunk.secondText) {
            next.secondText = u.secondText;
            prev.secondText = chunk.secondText;
          }
          if (Object.keys(next).length === 0) continue;
          batchUpdates.push({ layer: 'sentence', id: u.id, prev, next });
          newChunks[chunkIndex] = { ...chunk, ...next };
        }

        if (batchUpdates.length === 0) return;

        const action: BatchUpdateAction = { type: "batch", updates: batchUpdates };
        const derived = computeDerivedState(newChunks);

        set({
          chunks: newChunks,
          undoStack: [...state.undoStack, action],
          redoStack: [],
          lastUpdateTime: now,
          text: derived.text,
          duration: derived.duration,
          canUndo: true,
          canRedo: false,
        });
      },

      // 智能剪切：插入空白占位 chunk
      insertBlankChunks: (segments) => {
        const state = get();
        if (segments.length === 0) return;

        // 跳过已存在的同 id 占位 chunk，避免重复插入
        const existingIds = new Set(state.chunks.map(c => c.id));
        const newBlankChunks: Chunk[] = [];
        for (const seg of segments) {
          const id = `blank-${seg.start.toFixed(3)}-${seg.end.toFixed(3)}`;
          if (existingIds.has(id)) continue;
          newBlankChunks.push({
            id,
            text: '',
            timestamp: [seg.start, seg.end],
            deleted: true,
            isBlankSpacer: true,
          });
        }

        if (newBlankChunks.length === 0) return;

        const newChunks = [...state.chunks, ...newBlankChunks];
        newChunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);

        const action: InsertChunksAction = { type: "insert", chunks: newBlankChunks };
        const derived = computeDerivedState(newChunks);

        set({
          chunks: newChunks,
          undoStack: [...state.undoStack, action],
          redoStack: [],
          lastUpdateTime: Date.now(),
          text: derived.text,
          duration: derived.duration,
          canUndo: true,
          canRedo: false,
        });
      },

      // 重置所有状态
      reset: () => {
        set(initialState);
      },
    }),
    {
      name: 'history-store', // Redux DevTools
    }
  )
);

// 独立的状态选择器，避免创建新对象引用
export const useCanUndo = () => useHistoryStore(state => state.canUndo);
export const useCanRedo = () => useHistoryStore(state => state.canRedo);

// 独立的动作选择器，避免创建新对象引用
export const useSetTranscript = () => useHistoryStore(state => state.setTranscript);
export const useUpdate = () => useHistoryStore(state => state.update);
export const useDelete = () => useHistoryStore(state => state.delete);
export const useUndo = () => useHistoryStore(state => state.undo);
export const useRedo = () => useHistoryStore(state => state.redo);
export const useClearHistory = () => useHistoryStore(state => state.clearHistory);
export const useDeleteSelected = () => useHistoryStore(state => state.deleteSelected);
export const useRestoreSelected = () => useHistoryStore(state => state.restoreSelected);
export const useUpdateChunkText = () => useHistoryStore(state => state.updateChunkText);
export const useBatchUpdateText = () => useHistoryStore(state => state.batchUpdateText);
export const useInsertBlankChunks = () => useHistoryStore(state => state.insertBlankChunks);
export const useResetHistory = () => useHistoryStore(state => state.reset);

// 获取所有chunks（在组件中使用 useMemo 过滤）
export const useChunks = () => useHistoryStore(state => state.chunks);
export const useWordChunks = () => useHistoryStore(state => state.wordChunks);
export const useHasWordTimestamps = () => useHistoryStore(state => state.hasWordTimestamps);
export const useDeleteWord = () => useHistoryStore(state => state.deleteWord);

// 独立的选择器，避免创建新对象引用
export const useHistoryText = () => useHistoryStore(state => state.text);
export const useHistoryLanguage = () => useHistoryStore(state => state.language);
export const useHistoryDuration = () => useHistoryStore(state => state.duration);