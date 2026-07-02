import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
} from './asrPaths.mjs';

export const VAD_MAX_SPEECH_SECS = 30;
export const SENTENCE_MAX_DURATION_SECS = 10;
export const EPSILON = 0.25;

export function requireAsrPrerequisites(root = projectRoot()) {
  const demoMp4 = resolveDemoMp4(root);
  const sidecar = resolveSidecar(root);
  const ffmpeg = resolveFfmpeg(root);
  const fsmnVadDir = resolveFsmnVadDir(root);
  const vadModel = resolveVadModel(root);
  const modelId = process.env.ASR_TEST_MODEL_ID ?? DEFAULT_MODEL_ID;
  const modelDir = resolveModelDir(modelId, root);

  const missing = [];
  if (!existsSync(demoMp4)) missing.push(`demo video: ${demoMp4}`);
  if (!sidecar) missing.push('funasr-asr sidecar (run pnpm build:funasr-sidecar)');
  if (!ffmpeg) missing.push('bundled ffmpeg (run pnpm fetch:ffmpeg)');
  if (!fsmnVadDir) {
    missing.push('funasr-fsmn-vad (run pnpm fetch:shared-assets)');
  }
  if (!modelDir) {
    missing.push(`ASR model dir for ${modelId} (download in app or set ASR_TEST_MODEL_DIR)`);
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    demoMp4,
    sidecar,
    ffmpeg,
    fsmnVadDir,
    vadModel,
    modelId,
    modelDir,
    model: loadModelFromManifest(modelId, root),
  };
}

export function prepareInputMedia({
  demoMp4,
  ffmpeg,
  clipSecs = Number(process.env.ASR_TEST_CLIP_SECS ?? '60'),
}) {
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

  assert.equal(clip.status, 0, `ffmpeg clip failed:\n${clip.stderr ?? clip.stdout}`);
  assert.ok(existsSync(clippedPath), 'clipped demo.mp4 was not created');

  return {
    inputPath: clippedPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

export function runFunasrAsr({
  inputPath,
  sidecar,
  ffmpeg,
  fsmnVadDir,
  modelDir,
  model,
  language = 'zh',
  vadType = 'fsmn',
  vadModel,
}) {
  const recognizerConfig = JSON.stringify(model.recognizer_config);
  const args = [
    '--input',
    inputPath,
    '--model',
    modelDir,
    '--model-type',
    model.family,
    '--recognizer-config',
    recognizerConfig,
    '--vad-type',
    vadType,
  ];

  if (vadType === 'fsmn') {
    args.push('--vad-dir', fsmnVadDir);
  } else {
    args.push('--vad-model', vadModel);
  }

  args.push('--language', language, '--timestamp-mode', 'auto', '--output-json');

  const result = spawnSync(
    sidecar,
    args,
    {
      encoding: 'utf8',
      env: { ...process.env, FFMPEG_PATH: ffmpeg },
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  assert.equal(result.status, 0, `funasr-asr failed:\n${result.stderr ?? result.stdout}`);

  const stdout = result.stdout?.trim();
  assert.ok(stdout, 'funasr-asr returned empty stdout');
  return JSON.parse(stdout);
}

export function assertTranscriptShape(transcript, { tokenTimestampVerified = false } = {}) {
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

    const duration = end - start;
    maxChunkDuration = Math.max(maxChunkDuration, duration);

    const hasRealWordChunks = transcript.hasWordTimestamps
      && Array.isArray(transcript.wordChunks)
      && transcript.wordChunks.length > 0;

    if (tokenTimestampVerified && hasRealWordChunks) {
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

  if (transcript.hasWordTimestamps && Array.isArray(transcript.wordChunks) && transcript.wordChunks.length > 0) {
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