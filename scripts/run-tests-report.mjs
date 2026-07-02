#!/usr/bin/env node
/**
 * 运行测试并将完整输出写入 test-results/ 目录。
 * 用法：node scripts/run-tests-report.mjs [额外传给 node --test 的参数...]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const resultsDir = join(root, 'test-results');
mkdirSync(resultsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const latestPath = join(resultsDir, 'latest.txt');
const stampedPath = join(resultsDir, `report-${stamp}.txt`);

const extraArgs = process.argv.slice(2);
const testArgs = ['--test', 'tests/**/*.test.mjs', ...extraArgs];

const startedAt = new Date().toISOString();
const result = spawnSync('node', testArgs, {
  cwd: root,
  encoding: 'utf8',
  shell: false,
  maxBuffer: 64 * 1024 * 1024,
});

const header = [
  '# FlyCut Caption Test Report',
  `started_at: ${startedAt}`,
  `finished_at: ${new Date().toISOString()}`,
  `command: node ${testArgs.join(' ')}`,
  `exit_code: ${result.status ?? 'null'}`,
  '',
].join('\n');

const body = [
  result.stdout ?? '',
  result.stderr ?? '',
].join('\n').trimEnd();

const report = `${header}\n${body}\n`;
writeFileSync(latestPath, report, 'utf8');
writeFileSync(stampedPath, report, 'utf8');

process.stdout.write(report);
process.exit(result.status ?? 1);