import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './asrPaths.mjs';

const defaultDir = join(projectRoot(), 'test-results', 'json');

export function transcriptJsonDir() {
  return process.env.ASR_TEST_JSON_DIR ?? defaultDir;
}

export function saveTranscriptJson({
  family,
  modelId,
  language,
  inputPath,
  transcript,
  dir = transcriptJsonDir(),
}) {
  mkdirSync(dir, { recursive: true });

  const payload = {
    meta: {
      family,
      modelId,
      language,
      input: inputPath,
      exportedAt: new Date().toISOString(),
      chunkCount: transcript.chunks?.length ?? 0,
      hasWordTimestamps: transcript.hasWordTimestamps ?? false,
      duration: transcript.duration,
      textLength: transcript.text?.length ?? 0,
    },
    transcript,
  };

  const safeName = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const filePath = join(dir, `${family}__${safeName}.json`);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

export function saveTranscriptIndex(entries, dir = transcriptJsonDir()) {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, 'index.json');
  writeFileSync(
    indexPath,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)}\n`,
    'utf8',
  );
  return indexPath;
}