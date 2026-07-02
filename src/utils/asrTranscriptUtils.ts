import type { SubtitleChunk, SubtitleTranscript } from '@/types/subtitle';
import { resolveCuttingChunks } from '@/utils/wordLevelEdit';
import { groupWordsIntoSentences } from '@/utils/timeUtils';

function withDeleted(chunk: SubtitleChunk): SubtitleChunk {
  return { ...chunk, deleted: chunk.deleted ?? false };
}

/**
 * 将 ASR 原始结果规范为「句子必选 + 字词可选」结构。
 * - 有 wordChunks：用字词分组生成句子 chunks，并建立 sentenceId / wordIds 关联
 * - 无 wordChunks：chunks 即为句子级（通常为 VAD 段）
 */
export function normalizeAsrTranscript(transcript: SubtitleTranscript): SubtitleTranscript {
  // sidecar 已输出句子 + 字词双层级时直接采用
  if (
    transcript.hasWordTimestamps &&
    transcript.wordChunks?.length &&
    transcript.chunks.length > 0
  ) {
    return {
      ...transcript,
      chunks: transcript.chunks.map(withDeleted),
      wordChunks: transcript.wordChunks.map(withDeleted),
    };
  }

  const wordChunks = transcript.wordChunks?.map(withDeleted);
  if (!wordChunks?.length) {
    return {
      ...transcript,
      hasWordTimestamps: false,
      chunks: transcript.chunks.map(withDeleted),
      wordChunks: undefined,
    };
  }

  const grouped = groupWordsIntoSentences(
    wordChunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      timestamp: chunk.timestamp,
      selected: chunk.selected,
    })),
  );

  const sentenceChunks: SubtitleChunk[] = grouped.map((sentence) => ({
    id: sentence.id,
    text: sentence.text,
    timestamp: sentence.timestamp,
    deleted: false,
    wordIds: sentence.wordChunks.map((word) => word.id),
  }));

  const sentenceIdByWordId = new Map<string, string>();
  for (const sentence of grouped) {
    for (const word of sentence.wordChunks) {
      sentenceIdByWordId.set(word.id, sentence.id);
    }
  }

  const linkedWordChunks = wordChunks.map((word) => ({
    ...word,
    sentenceId: sentenceIdByWordId.get(word.id),
  }));

  return {
    ...transcript,
    hasWordTimestamps: true,
    chunks: sentenceChunks,
    wordChunks: linkedWordChunks,
  };
}

/** 视频裁剪应使用的粒度：有字词时间戳时用 wordChunks，否则用句子 chunks */
export function getCuttingChunks(
  chunks: SubtitleChunk[],
  wordChunks: SubtitleChunk[] | undefined,
  hasWordTimestamps: boolean,
): SubtitleChunk[] {
  return resolveCuttingChunks(chunks, wordChunks, hasWordTimestamps);
}