import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  projectRoot,
  resolveDemoMp4,
  resolveFfmpeg,
  resolveFsmnVadDir,
  resolveSidecar,
  resolveVadModel,
} from './asrPaths.mjs';

export function requireVadPrerequisites(root = projectRoot()) {
  const demoMp4 = resolveDemoMp4(root);
  const sidecar = resolveSidecar(root);
  const ffmpeg = resolveFfmpeg(root);
  const fsmnVadDir = resolveFsmnVadDir(root);
  const sileroVadModel = resolveVadModel(root);

  const missing = [];
  if (!existsSync(demoMp4)) missing.push(`demo video: ${demoMp4}`);
  if (!sidecar) missing.push('funasr-asr sidecar');
  if (!ffmpeg) missing.push('ffmpeg');

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    demoMp4,
    sidecar,
    ffmpeg,
    fsmnVadDir,
    sileroVadModel,
  };
}

export function runVadDump({
  inputPath,
  sidecar,
  ffmpeg,
  vadType = 'fsmn',
  fsmnVadDir,
  sileroVadModel,
}) {
  const args = [
    '--input',
    inputPath,
    '--vad-type',
    vadType,
    '--vad-dump-json',
  ];

  if (vadType === 'fsmn') {
    assert.ok(fsmnVadDir, 'FSMN VAD dir required');
    args.push('--vad-dir', fsmnVadDir);
  } else {
    assert.ok(sileroVadModel, 'silero VAD model required');
    args.push('--vad-model', sileroVadModel);
  }

  const result = spawnSync(sidecar, args, {
    encoding: 'utf8',
    env: { ...process.env, FFMPEG_PATH: ffmpeg },
    maxBuffer: 8 * 1024 * 1024,
  });

  assert.equal(result.status, 0, `vad dump failed:\n${result.stderr ?? result.stdout}`);
  const stdout = result.stdout?.trim();
  assert.ok(stdout, 'empty vad dump stdout');
  return JSON.parse(stdout);
}

export function assertVadDumpShape(dump, { minSegments = 1, maxSegments = 200 } = {}) {
  assert.equal(typeof dump.vadType, 'string');
  assert.equal(typeof dump.duration, 'number');
  assert.ok(dump.duration > 0);
  assert.equal(typeof dump.segmentCount, 'number');
  assert.ok(Array.isArray(dump.segments));
  assert.equal(dump.segmentCount, dump.segments.length);
  assert.ok(dump.segmentCount >= minSegments, `too few segments: ${dump.segmentCount}`);
  assert.ok(dump.segmentCount <= maxSegments, `too many segments: ${dump.segmentCount}`);

  let prevEnd = -Infinity;
  for (const [startMs, endMs] of dump.segments) {
    assert.ok(Number.isFinite(startMs) && Number.isFinite(endMs));
    assert.ok(endMs > startMs, `invalid segment [${startMs}, ${endMs}]`);
    assert.ok(startMs >= prevEnd - 50, 'segments should be roughly monotonic');
    assert.ok(endMs <= dump.duration * 1000 + 500);
    prevEnd = endMs;
  }

  return {
    segmentCount: dump.segmentCount,
    duration: dump.duration,
    firstSegments: dump.segments.slice(0, 5),
    lastSegment: dump.segments.at(-1),
  };
}