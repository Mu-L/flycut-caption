import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { prepareInputMedia } from './lib/funasrRunner.mjs';
import {
  assertVadDumpShape,
  requireVadPrerequisites,
  runVadDump,
} from './lib/vadRunner.mjs';

const clipSecs = Number(process.env.VAD_TEST_CLIP_SECS ?? '60');

describe('FSMN VAD integration', () => {
  it('dumps valid speech segments from demo media', { timeout: 120_000 }, (t) => {
    const prereq = requireVadPrerequisites();
    if (!prereq.ok) {
      return t.skip(`Missing prerequisites: ${prereq.missing.join('; ')}`);
    }
    if (!prereq.fsmnVadDir) {
      return t.skip('funasr-fsmn-vad assets missing (run pnpm fetch:shared-assets)');
    }

    const { inputPath, cleanup } = prepareInputMedia({
      demoMp4: prereq.demoMp4,
      ffmpeg: prereq.ffmpeg,
      clipSecs,
    });

    try {
      const dump = runVadDump({
        inputPath,
        sidecar: prereq.sidecar,
        ffmpeg: prereq.ffmpeg,
        vadType: 'fsmn',
        fsmnVadDir: prereq.fsmnVadDir,
      });
      const summary = assertVadDumpShape(dump, {
        minSegments: clipSecs > 0 ? 2 : 5,
        maxSegments: clipSecs > 0 ? 40 : 80,
      });

      console.log(
        [
          `vadType: ${dump.vadType}`,
          `input: ${inputPath}`,
          `duration: ${summary.duration.toFixed(2)}s`,
          `segmentCount: ${summary.segmentCount}`,
          `firstSegments: ${JSON.stringify(summary.firstSegments)}`,
          `lastSegment: ${JSON.stringify(summary.lastSegment)}`,
        ].join('\n'),
      );
    } finally {
      cleanup();
    }
  });

  it('full demo FSMN VAD segment count is stable (reference band)', { timeout: 180_000 }, (t) => {
    const prereq = requireVadPrerequisites();
    if (!prereq.ok) {
      return t.skip(`Missing prerequisites: ${prereq.missing.join('; ')}`);
    }
    if (!prereq.fsmnVadDir) {
      return t.skip('funasr-fsmn-vad assets missing');
    }
    if (process.env.VAD_TEST_SKIP_FULL === '1') {
      return t.skip('VAD_TEST_SKIP_FULL=1');
    }

    const dump = runVadDump({
      inputPath: prereq.demoMp4,
      sidecar: prereq.sidecar,
      ffmpeg: prereq.ffmpeg,
      vadType: 'fsmn',
      fsmnVadDir: prereq.fsmnVadDir,
    });
    const summary = assertVadDumpShape(dump, { minSegments: 10, maxSegments: 35 });

    // Python funasr_onnx reference on the same demo ≈ 19 segments
    assert.ok(
      summary.segmentCount >= 15 && summary.segmentCount <= 25,
      `expected ~19 segments, got ${summary.segmentCount}`,
    );

    console.log(
      [
        'full-demo FSMN VAD reference check',
        `duration: ${summary.duration.toFixed(2)}s`,
        `segmentCount: ${summary.segmentCount} (expected 15-25, ref≈19)`,
        `segments: ${JSON.stringify(dump.segments)}`,
      ].join('\n'),
    );
  });
});

describe('FSMN vs Silero VAD comparison', () => {
  it('both backends produce segments on demo clip', { timeout: 120_000 }, (t) => {
    const prereq = requireVadPrerequisites();
    if (!prereq.ok) {
      return t.skip(`Missing prerequisites: ${prereq.missing.join('; ')}`);
    }
    if (!prereq.fsmnVadDir || !prereq.sileroVadModel) {
      return t.skip('Need both funasr-fsmn-vad and silero-vad assets');
    }

    const { inputPath, cleanup } = prepareInputMedia({
      demoMp4: prereq.demoMp4,
      ffmpeg: prereq.ffmpeg,
      clipSecs: 60,
    });

    try {
      const fsmn = runVadDump({
        inputPath,
        sidecar: prereq.sidecar,
        ffmpeg: prereq.ffmpeg,
        vadType: 'fsmn',
        fsmnVadDir: prereq.fsmnVadDir,
      });
      const silero = runVadDump({
        inputPath,
        sidecar: prereq.sidecar,
        ffmpeg: prereq.ffmpeg,
        vadType: 'silero',
        sileroVadModel: prereq.sileroVadModel,
      });

      const fsmnSummary = assertVadDumpShape(fsmn);
      const sileroSummary = assertVadDumpShape(silero);

      console.log(
        [
          'VAD comparison (60s clip)',
          `fsmn segments: ${fsmnSummary.segmentCount}`,
          `silero segments: ${sileroSummary.segmentCount}`,
          `fsmn first: ${JSON.stringify(fsmnSummary.firstSegments[0])}`,
          `silero first: ${JSON.stringify(sileroSummary.firstSegments[0])}`,
        ].join('\n'),
      );

      assert.notEqual(fsmn.vadType, silero.vadType);
      assert.ok(existsSync(prereq.fsmnVadDir));
      assert.ok(existsSync(prereq.sileroVadModel));
    } finally {
      cleanup();
    }
  });
});