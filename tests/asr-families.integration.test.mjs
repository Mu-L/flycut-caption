import { describe, it } from 'node:test';
import {
  FAMILY_LANGUAGES,
  representativeModelsByFamily,
  resolveModelDir,
} from './lib/asrPaths.mjs';
import {
  assertTranscriptShape,
  prepareInputMedia,
  requireAsrPrerequisites,
  runFunasrAsr,
} from './lib/funasrRunner.mjs';
import { saveTranscriptJson } from './lib/saveTranscriptJson.mjs';

const saveJson = process.env.ASR_TEST_SAVE_JSON === '1';

const clipSecs = process.env.ASR_TEST_FULL === '1'
  ? 0
  : Number(process.env.ASR_TEST_CLIP_SECS ?? '60');

const familyFilter = process.env.ASR_TEST_FAMILIES
  ? new Set(process.env.ASR_TEST_FAMILIES.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const fixtures = representativeModelsByFamily().filter(
  ({ family }) => !familyFilter || familyFilter.has(family),
);

describe('ASR family smoke tests — one model per family', () => {
  for (const { family, model } of fixtures) {
    it(
      `${family} (${model.id}) returns valid subtitle JSON`,
      { timeout: clipSecs > 0 ? 300_000 : 900_000 },
      (t) => {
        const prereq = requireAsrPrerequisites();
        if (!prereq.ok) {
          return t.skip(`Missing prerequisites: ${prereq.missing.join('; ')}`);
        }

        const modelDir = resolveModelDir(model.id);
        if (!modelDir) {
          return t.skip(`Model not downloaded: ${model.id} (download in app or set ASR_TEST_MODEL_DIR)`);
        }

        const language = FAMILY_LANGUAGES[family] ?? 'en';
        const { inputPath, cleanup } = prepareInputMedia({
          demoMp4: prereq.demoMp4,
          ffmpeg: prereq.ffmpeg,
          clipSecs,
        });

        try {
          const transcript = runFunasrAsr({
            inputPath,
            sidecar: prereq.sidecar,
            ffmpeg: prereq.ffmpeg,
            fsmnVadDir: prereq.fsmnVadDir,
            modelDir,
            model,
            language,
          });
          const summary = assertTranscriptShape(transcript, {
            tokenTimestampVerified: model.timestamp?.token_timestamp_verified === true,
          });

          if (saveJson) {
            const saved = saveTranscriptJson({
              family,
              modelId: model.id,
              language,
              inputPath,
              transcript,
            });
            console.log(`saved_json: ${saved}`);
          }

          console.log(
            [
              `family: ${family}`,
              `model: ${model.id}`,
              `language: ${language}`,
              `input: ${inputPath}`,
              `chunks: ${summary.chunkCount}`,
              `maxChunkDuration: ${summary.maxChunkDuration.toFixed(2)}s`,
              `hasWordTimestamps: ${summary.hasWordTimestamps}`,
            ].join('\n'),
          );
        } finally {
          cleanup();
        }
      },
    );
  }
});