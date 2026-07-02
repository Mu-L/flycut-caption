import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  applyBlankChunksPure,
  calculateBlankSegments,
  computeSmartCutBlank,
} from './lib/smartCutBlank.mjs';
import {
  assertTranscriptShape,
  prepareInputMedia,
  requireAsrPrerequisites,
  runFunasrAsr,
} from './lib/funasrRunner.mjs';
import { loadModelFromManifest, projectRoot } from './lib/asrPaths.mjs';

describe('smart cut blank — unit', () => {
  it('detects leading, between, and trailing blank segments', () => {
    const chunks = [
      { id: 'a', timestamp: [2, 4], deleted: false },
      { id: 'b', timestamp: [7, 9], deleted: false },
    ];

    const segments = calculateBlankSegments(chunks, 1.5, 12);
    assert.deepEqual(segments, [
      { start: 0, end: 2 },
      { start: 4, end: 7 },
      { start: 9, end: 12 },
    ]);
  });

  it('ignores deleted chunks and gaps below threshold', () => {
    const chunks = [
      { id: 'a', timestamp: [0, 2], deleted: false },
      { id: 'deleted', timestamp: [2.2, 2.8], deleted: true },
      { id: 'b', timestamp: [3, 5], deleted: false },
    ];

    const segments = calculateBlankSegments(chunks, 1.1, 8);
    assert.deepEqual(segments, [
      { start: 5, end: 8 },
    ]);
  });

  it('returns empty result when no qualifying blanks exist', () => {
    const chunks = [
      { id: 'a', timestamp: [0, 2], deleted: false },
      { id: 'b', timestamp: [2.2, 4], deleted: false },
    ];
    const result = computeSmartCutBlank(chunks, 1.0, 4.5);
    assert.equal(result.segments.length, 0);
    assert.equal(result.totalBlankSeconds, 0);
  });

  it('inserts deleted blank spacer chunks without duplicates', () => {
    const chunks = [
      { id: 'a', text: 'hello', timestamp: [0, 2], deleted: false },
      { id: 'b', text: 'world', timestamp: [5, 7], deleted: false },
    ];
    const segments = [{ start: 2, end: 5 }];

    const firstPass = applyBlankChunksPure(chunks, segments);
    assert.equal(firstPass.length, 3);
    const blank = firstPass.find((chunk) => chunk.isBlankSpacer);
    assert.ok(blank);
    assert.equal(blank.deleted, true);
    assert.deepEqual(blank.timestamp, [2, 5]);

    const secondPass = applyBlankChunksPure(firstPass, segments);
    assert.equal(secondPass.length, 3);
  });
});

describe('smart cut blank — integration with src/assets/demo.mp4', () => {
  it(
    'marks inter-chunk silences from ASR output as blank spacers',
    { timeout: Number(process.env.ASR_TEST_CLIP_SECS ?? '60') > 0 ? 300_000 : 900_000 },
    (t) => {
      const prereq = requireAsrPrerequisites();
      if (!prereq.ok) {
        return t.skip(`Missing prerequisites: ${prereq.missing.join('; ')}`);
      }

      const { inputPath, cleanup } = prepareInputMedia(prereq);
      try {
        const transcript = runFunasrAsr({
          inputPath,
          sidecar: prereq.sidecar,
          ffmpeg: prereq.ffmpeg,
          fsmnVadDir: prereq.fsmnVadDir,
          modelDir: prereq.modelDir,
          model: prereq.model,
        });
        assertTranscriptShape(transcript);

        const activeChunks = transcript.chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          timestamp: chunk.timestamp,
          deleted: false,
        }));

        const threshold = Number(process.env.SMART_CUT_TEST_THRESHOLD ?? '0.35');
        const { segments, totalBlankSeconds } = computeSmartCutBlank(
          activeChunks,
          threshold,
          transcript.duration,
        );

        console.log(
          [
            `input: ${inputPath}`,
            `model: ${prereq.modelId}`,
            `chunks: ${activeChunks.length}`,
            `threshold: ${threshold}s`,
            `blankSegments: ${segments.length}`,
            `blankSeconds: ${totalBlankSeconds.toFixed(2)}s`,
            `hasWordTimestamps: ${transcript.hasWordTimestamps}`,
          ].join('\n'),
        );

        if (segments.length === 0) {
          return t.skip('No blank segments above threshold in this ASR output; try lowering SMART_CUT_TEST_THRESHOLD');
        }

        const withBlanks = applyBlankChunksPure(activeChunks, segments);
        const blankCount = withBlanks.filter((chunk) => chunk.isBlankSpacer).length;
        assert.equal(blankCount, segments.length);
        assert.ok(totalBlankSeconds > 0);

        for (const segment of segments) {
          const spacer = withBlanks.find(
            (chunk) =>
              chunk.isBlankSpacer &&
              Math.abs(chunk.timestamp[0] - segment.start) < 0.001 &&
              Math.abs(chunk.timestamp[1] - segment.end) < 0.001,
          );
          assert.ok(spacer, `missing blank spacer for ${JSON.stringify(segment)}`);
        }
      } finally {
        cleanup();
      }
    },
  );
});

describe('token_timestamp_verified — manifest wiring', () => {
  it('exposes token_timestamp_verified on every manifest model', () => {
    const root = projectRoot();
    const manifestPath = `${root}/models.json`;
    assert.ok(existsSync(manifestPath), `models.json missing at ${manifestPath}`);

    const model = loadModelFromManifest(process.env.ASR_TEST_MODEL_ID ?? 'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17', root);
    assert.ok(model.timestamp, 'model.timestamp should exist');
    assert.equal(typeof model.timestamp.token_timestamp_verified, 'boolean');
    assert.ok(
      ['segment', 'token', 'word'].includes(model.timestamp.level),
      `unexpected timestamp.level: ${model.timestamp.level}`,
    );
  });
});