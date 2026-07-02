import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SENTENCE_GROUPING_OPTIONS,
  groupWordsIntoSentences,
  resolveSentenceGroupingOptions,
} from '../src/utils/timeUtils.ts';

function word(id, text, start, end) {
  return { id, text, timestamp: [start, end] };
}

describe('sentence grouping — configurable options', () => {
  it('exposes default grouping options', () => {
    assert.equal(DEFAULT_SENTENCE_GROUPING_OPTIONS.maxDurationSec, 10);
    assert.equal(DEFAULT_SENTENCE_GROUPING_OPTIONS.pauseThresholdSec, 0.6);
    assert.ok(DEFAULT_SENTENCE_GROUPING_OPTIONS.sentenceEnders.includes(','));
    assert.ok(DEFAULT_SENTENCE_GROUPING_OPTIONS.sentenceEnders.includes('，'));
    assert.ok(DEFAULT_SENTENCE_GROUPING_OPTIONS.sentenceEnders.includes(' '));
  });

  it('breaks on comma enders by default', () => {
    const chunks = [
      word('w1', '你', 0, 0.2),
      word('w2', '好', 0.2, 0.4),
      word('w3', '，', 0.4, 0.45),
      word('w4', '世', 0.5, 0.7),
      word('w5', '界', 0.7, 0.9),
    ];

    const sentences = groupWordsIntoSentences(chunks);
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0].text, '你好，');
    assert.equal(sentences[1].text, '世界');
  });

  it('can keep comma inside one sentence when comma is removed from enders', () => {
    const chunks = [
      word('w1', '你', 0, 0.2),
      word('w2', '好', 0.2, 0.4),
      word('w3', '，', 0.4, 0.45),
      word('w4', '世', 0.5, 0.7),
      word('w5', '界', 0.7, 0.9),
    ];

    const sentences = groupWordsIntoSentences(chunks, {
      sentenceEnders: ['.', '!', '?', '。', '！', '？', '…', '；', ';'],
    });
    assert.equal(sentences.length, 1);
    assert.equal(sentences[0].text, '你好，世界');
  });

  it('breaks on strong sentence enders', () => {
    const chunks = [
      word('w1', '第一句', 0, 1),
      word('w2', '。', 1, 1.1),
      word('w3', '第二句', 1.5, 2.5),
    ];

    const sentences = groupWordsIntoSentences(chunks);
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0].text, '第一句。');
    assert.equal(sentences[1].text, '第二句');
  });

  it('breaks on trailing space token', () => {
    const chunks = [
      word('w1', 'hello ', 0, 0.5),
      word('w2', 'world', 0.6, 1.0),
    ];

    const sentences = groupWordsIntoSentences(chunks);
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0].text, 'hello');
    assert.equal(sentences[1].text, 'world');
  });

  it('respects custom maxDurationSec and pauseThresholdSec', () => {
    const chunks = [
      word('w1', '一', 0, 0.2),
      word('w2', '二', 1.0, 1.2),
      word('w3', '三', 1.2, 1.4),
    ];

    const sentences = groupWordsIntoSentences(chunks, {
      maxDurationSec: 60,
      pauseThresholdSec: 0.5,
      sentenceEnders: ['。'],
    });
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0].text, '一');
    assert.equal(sentences[1].text, '二三');
  });

  it('keeps a complete clause until period even with many tokens', () => {
    const chunks = [
      word('w1', '晚', 9.1, 9.28),
      word('w2', '了，', 9.28, 10.18),
      word('w3', '鹅', 10.18, 10.42),
      word('w4', '城', 10.42, 10.54),
      word('w5', '的', 10.54, 10.72),
      word('w6', '饭', 10.72, 10.84),
      word('w7', '馆', 10.84, 11.02),
      word('w8', '把', 11.02, 11.32),
      word('w9', '预', 11.32, 11.44),
      word('w10', '制', 11.44, 11.62),
      word('w11', '菜', 11.62, 11.8),
      word('w12', '卖', 11.8, 11.92),
      word('w13', '到', 11.92, 12.16),
      word('w14', '9', 12.16, 12.34),
      word('w15', '0', 12.34, 12.46),
      word('w16', '年', 12.46, 12.64),
      word('w17', '以', 12.64, 12.76),
      word('w18', '后', 12.76, 12.88),
      word('w19', '了。', 12.88, 13.24),
    ];

    const sentences = groupWordsIntoSentences(chunks);
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0].text, '晚了，');
    assert.equal(sentences[1].text, '鹅城的饭馆把预制菜卖到90年以后了。');
  });

  it('merges adjacent digit tokens before grouping by default', () => {
    const chunks = [
      word('w1', '卖', 0, 0.2),
      word('w2', '到', 0.2, 0.4),
      word('w3', '1', 0.4, 0.5),
      word('w4', '0', 0.5, 0.6),
      word('w5', '0', 0.6, 0.7),
      word('w6', '年', 0.7, 0.9),
      word('w7', '了。', 0.9, 1.1),
    ];

    const sentences = groupWordsIntoSentences(chunks);
    assert.equal(sentences.length, 1);
    assert.equal(sentences[0].text, '卖到100年了。');
    assert.equal(sentences[0].wordChunks.length, 5);
    assert.equal(sentences[0].wordChunks[2].text, '100');
  });

  it('resolveSentenceGroupingOptions merges partial overrides', () => {
    const resolved = resolveSentenceGroupingOptions({ maxDurationSec: 8 });
    assert.equal(resolved.maxDurationSec, 8);
    assert.equal(resolved.pauseThresholdSec, 0.6);
    assert.ok(resolved.sentenceEnders.includes(','));
  });
});