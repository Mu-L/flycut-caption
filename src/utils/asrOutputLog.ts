import type { SubtitleChunk, SubtitleTranscript } from '@/types/subtitle';

export interface AsrOutputLogMeta {
  source: string;
  stage?: string;
}

function isSubtitleTranscript(value: unknown): value is SubtitleTranscript {
  if (!value || typeof value !== 'object') return false;
  const t = value as SubtitleTranscript;
  return typeof t.text === 'string' && Array.isArray(t.chunks);
}

function formatChunkLine(chunk: SubtitleChunk, index: number): string {
  const [start, end] = chunk.timestamp;
  const duration = (end - start).toFixed(2);
  return `[${index + 1}] ${start.toFixed(2)}-${end.toFixed(2)}s (${duration}s) | ${chunk.text}`;
}

/**
 * 在控制台完整输出 ASR 模型结果（摘要 + 逐条 chunks + 完整 JSON）。
 */
export function logAsrModelOutput(
  output: SubtitleTranscript | Record<string, unknown>,
  meta: AsrOutputLogMeta,
): void {
  const stage = meta.stage ?? 'model-output';
  const label = `[ASR] ${meta.source} — ${stage}`;

  console.group(label);

  if (isSubtitleTranscript(output)) {
    const transcript = output;
    const maxChunkDuration = transcript.chunks.reduce((max, chunk) => {
      const duration = chunk.timestamp[1] - chunk.timestamp[0];
      return Math.max(max, duration);
    }, 0);

    console.log('摘要', {
      language: transcript.language,
      duration: transcript.duration,
      hasWordTimestamps: transcript.hasWordTimestamps ?? false,
      chunkCount: transcript.chunks.length,
      wordChunkCount: transcript.wordChunks?.length ?? 0,
      textLength: transcript.text.length,
      maxChunkDurationSec: Number(maxChunkDuration.toFixed(3)),
    });

    console.log('全文', transcript.text);

    console.log(`句子 chunks（共 ${transcript.chunks.length} 条）`);
    transcript.chunks.forEach((chunk, index) => {
      console.log(formatChunkLine(chunk, index));
    });

    if (transcript.wordChunks?.length) {
      console.log(`字词 wordChunks（共 ${transcript.wordChunks.length} 条）`);
      transcript.wordChunks.forEach((chunk, index) => {
        console.log(formatChunkLine(chunk, index));
      });
    }

    console.log('完整对象（可展开）', structuredClone(transcript));
    console.log('完整 JSON 字符串:\n', JSON.stringify(transcript, null, 2));
  } else {
    console.log('原始 pipeline 输出（可展开）', output);
    console.log('完整 JSON 字符串:\n', JSON.stringify(output, null, 2));
  }

  console.groupEnd();
}