import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  DEFAULT_MODEL_ID,
  loadModelFromManifest,
  projectRoot,
  resolveDemoMp4,
  resolveFfmpeg,
  resolveModelDir,
  resolveSidecar,
  resolveFsmnVadDir,
  resolveVadModel,
} from './lib/asrPaths.mjs';
import { saveTranscriptJson } from './lib/saveTranscriptJson.mjs';

const saveJson = process.env.ASR_TEST_SAVE_JSON === '1';
const VAD_MAX_SPEECH_SECS = 30;
const SENTENCE_MAX_DURATION_SECS = 10;
const EPSILON = 0.25;

const root = projectRoot();
const demoMp4 = resolveDemoMp4(root);
const sidecar = resolveSidecar(root);
const ffmpeg = resolveFfmpeg(root);
const fsmnVadDir = resolveFsmnVadDir(root);
const vadModel = resolveVadModel(root);
const modelId = process.env.ASR_TEST_MODEL_ID ?? DEFAULT_MODEL_ID;
const modelDir = resolveModelDir(modelId, root);
const model = loadModelFromManifest(modelId, root);

const clipSecs = process.env.ASR_TEST_FULL === '1'
  ? 0
  : Number(process.env.ASR_TEST_CLIP_SECS ?? '60');

function requirePrerequisites() {
  const missing = [];
  if (!existsSync(demoMp4)) missing.push(`demo video: ${demoMp4}`);
  if (!sidecar) missing.push('funasr-asr sidecar (run pnpm build:funasr-sidecar)');
  if (!ffmpeg) missing.push('bundled ffmpeg (run pnpm fetch:ffmpeg)');
  if (!fsmnVadDir) {
    missing.push('funasr-fsmn-vad (run pnpm fetch:shared-assets or scripts/fetch-funasr-fsmn-vad.sh)');
  }
  if (!modelDir) {
    missing.push(
      `ASR model dir for ${modelId} (download in app or set ASR_TEST_MODEL_DIR)`,
    );
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

function prepareInputMedia() {
  if (clipSecs <= 0) {
    return { inputPath: demoMp4, cleanup: () => {} };
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'flycut-asr-test-'));
  const clippedPath = join(tempDir, `demo-${clipSecs}s.mp4`);

  const clip = spawnSync(
    ffmpeg,
    ['-y', '-i', demoMp4, '-t', String(clipSecs), '-c', 'copy', clippedPath],
    { encoding: 'utf8' },
  );

  assert.equal(
    clip.status,
    0,
    `ffmpeg clip failed:\n${clip.stderr ?? clip.stdout}`,
  );
  assert.ok(existsSync(clippedPath), 'clipped demo.mp4 was not created');

  return {
    inputPath: clippedPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

function runFunasrAsr(inputPath) {
  const recognizerConfig = JSON.stringify(model.recognizer_config);
  const result = spawnSync(
    sidecar,
    [
      '--input',
      inputPath,
      '--model',
      modelDir,
      '--model-type',
      model.family,
      '--recognizer-config',
      recognizerConfig,
      '--vad-type',
      'fsmn',
      '--vad-dir',
      fsmnVadDir,
      '--language',
      'zh',
      '--timestamp-mode',
      'auto',
      '--output-json',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, FFMPEG_PATH: ffmpeg },
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  assert.equal(
    result.status,
    0,
    `funasr-asr failed:\n${result.stderr ?? result.stdout}`,
  );

  const stdout = result.stdout?.trim();
  assert.ok(stdout, 'funasr-asr returned empty stdout');

  return JSON.parse(stdout);
}

function chunkDuration(chunk) {
  const [start, end] = chunk.timestamp;
  return end - start;
}

function assertTranscriptShape(transcript) {
  assert.equal(typeof transcript.text, 'string');
  assert.ok(transcript.text.trim().length > 0, 'transcript text should not be empty');
  assert.equal(typeof transcript.duration, 'number');
  assert.ok(transcript.duration > 0, 'duration should be positive');
  assert.equal(typeof transcript.language, 'string');
  assert.equal(typeof transcript.hasWordTimestamps, 'boolean');
  assert.ok(Array.isArray(transcript.chunks), 'chunks must be an array');
  assert.ok(transcript.chunks.length > 0, 'expected at least one subtitle chunk');

  let prevEnd = -Infinity;
  let maxChunkDuration = 0;

  for (const chunk of transcript.chunks) {
    assert.equal(typeof chunk.id, 'string');
    assert.equal(typeof chunk.text, 'string');
    assert.ok(Array.isArray(chunk.timestamp) && chunk.timestamp.length === 2);

    const [start, end] = chunk.timestamp;
    assert.ok(Number.isFinite(start) && Number.isFinite(end));
    assert.ok(end >= start, `invalid chunk timestamps: ${JSON.stringify(chunk.timestamp)}`);
    assert.ok(start >= prevEnd - EPSILON, 'chunk timestamps should be monotonic');
    assert.ok(end <= transcript.duration + EPSILON, 'chunk end should not exceed media duration');

    const duration = chunkDuration(chunk);
    maxChunkDuration = Math.max(maxChunkDuration, duration);

    if (transcript.hasWordTimestamps) {
      assert.ok(
        duration <= SENTENCE_MAX_DURATION_SECS + EPSILON,
        `sentence chunk too long (${duration.toFixed(2)}s): ${chunk.text}`,
      );
    } else {
      assert.ok(
        duration <= VAD_MAX_SPEECH_SECS + EPSILON,
        `VAD chunk too long (${duration.toFixed(2)}s): ${chunk.text}`,
      );
    }

    prevEnd = end;
  }

  if (transcript.hasWordTimestamps) {
    assert.ok(Array.isArray(transcript.wordChunks), 'wordChunks required when hasWordTimestamps=true');
    assert.ok(transcript.wordChunks.length > 0, 'wordChunks should not be empty');
  }

  return {
    chunkCount: transcript.chunks.length,
    maxChunkDuration,
    hasWordTimestamps: transcript.hasWordTimestamps,
    duration: transcript.duration,
    textLength: transcript.text.length,
  };
}

describe('ASR integration — src/assets/demo.mp4', () => {
  it(
    'runs funasr-asr on demo.mp4 and returns valid subtitle JSON',
    { timeout: clipSecs > 0 ? 300_000 : 900_000 },
    (t) => {
      const prereq = requirePrerequisites();
      if (!prereq.ok) {
        return t.skip(`Missing prerequisites: ${prereq.missing.join('; ')}`);
      }

      const { inputPath, cleanup } = prepareInputMedia();
      try {
        const transcript = runFunasrAsr(inputPath);
        const summary = assertTranscriptShape(transcript);

        if (saveJson) {
          const saved = saveTranscriptJson({
            family: model.family,
            modelId,
            language: 'zh',
            inputPath,
            transcript,
          });
          console.log(`saved_json: ${saved}`);
        }

        console.log(
          [
            `input: ${inputPath}`,
            `model: ${modelId}`,
            `chunks: ${summary.chunkCount}`,
            `maxChunkDuration: ${summary.maxChunkDuration.toFixed(2)}s`,
            `hasWordTimestamps: ${summary.hasWordTimestamps}`,
            `duration: ${summary.duration.toFixed(2)}s`,
            `textLength: ${summary.textLength}`,
          ].join('\n'),
        );
      } finally {
        cleanup();
      }
    },
  );
});