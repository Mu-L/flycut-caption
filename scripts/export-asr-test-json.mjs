#!/usr/bin/env node
/**
 * 对所有 family 代表模型运行 funasr-asr，将完整 transcript JSON 写入 test-results/json/
 * 用法：node scripts/export-asr-test-json.mjs
 */
import {
  FAMILY_LANGUAGES,
  representativeModelsByFamily,
  resolveModelDir,
} from '../tests/lib/asrPaths.mjs';
import {
  assertTranscriptShape,
  prepareInputMedia,
  requireAsrPrerequisites,
  runFunasrAsr,
} from '../tests/lib/funasrRunner.mjs';
import {
  saveTranscriptIndex,
  saveTranscriptJson,
  transcriptJsonDir,
} from '../tests/lib/saveTranscriptJson.mjs';

const clipSecs = process.env.ASR_TEST_FULL === '1'
  ? 0
  : Number(process.env.ASR_TEST_CLIP_SECS ?? '60');

const familyFilter = process.env.ASR_TEST_FAMILIES
  ? new Set(process.env.ASR_TEST_FAMILIES.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const fixtures = representativeModelsByFamily().filter(
  ({ family }) => !familyFilter || familyFilter.has(family),
);

const prereq = requireAsrPrerequisites();
if (!prereq.ok) {
  console.error(`Missing prerequisites: ${prereq.missing.join('; ')}`);
  process.exit(1);
}

const outDir = transcriptJsonDir();
console.log(`Exporting ASR transcript JSON -> ${outDir}\n`);

const entries = [];

for (const { family, model } of fixtures) {
  const modelDir = resolveModelDir(model.id);
  if (!modelDir) {
    console.warn(`[skip] ${model.id} — model not downloaded`);
    entries.push({ family, modelId: model.id, status: 'skipped', reason: 'model not downloaded' });
    continue;
  }

  const language = FAMILY_LANGUAGES[family] ?? 'en';
  const { inputPath, cleanup } = prepareInputMedia({
    demoMp4: prereq.demoMp4,
    ffmpeg: prereq.ffmpeg,
    clipSecs,
  });

  try {
    console.log(`[run] ${family} / ${model.id} (${language})`);
    const transcript = runFunasrAsr({
      inputPath,
      sidecar: prereq.sidecar,
      ffmpeg: prereq.ffmpeg,
      fsmnVadDir: prereq.fsmnVadDir,
      vadModel: prereq.vadModel,
      modelDir,
      model,
      language,
    });

    assertTranscriptShape(transcript, {
      tokenTimestampVerified: model.timestamp?.token_timestamp_verified === true,
    });

    const filePath = saveTranscriptJson({
      family,
      modelId: model.id,
      language,
      inputPath,
      transcript,
      dir: outDir,
    });

    console.log(`[saved] ${filePath}`);
    entries.push({
      family,
      modelId: model.id,
      language,
      status: 'ok',
      file: filePath,
      chunkCount: transcript.chunks.length,
      hasWordTimestamps: transcript.hasWordTimestamps,
      duration: transcript.duration,
    });
  } catch (err) {
    console.error(`[fail] ${model.id}: ${err.message}`);
    entries.push({
      family,
      modelId: model.id,
      status: 'failed',
      error: err.message,
    });
  } finally {
    cleanup();
  }
}

const indexPath = saveTranscriptIndex(entries, outDir);
console.log(`\n[index] ${indexPath}`);

const failed = entries.filter((e) => e.status === 'failed');
process.exit(failed.length > 0 ? 1 : 0);