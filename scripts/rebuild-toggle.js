#!/usr/bin/env node
/**
 * better-sqlite3 의 네이티브 바이너리를 Node ABI / Electron ABI 사이에서 토글한다.
 * npm scripts 에 & ; & 를 쌓는 방식보다 명시적.
 *
 * 사용:
 *   node scripts/rebuild-toggle.js node       # CLI 실행 전
 *   node scripts/rebuild-toggle.js electron   # CLI 실행 후 (앱으로 복귀)
 */

const { spawnSync } = require('child_process');

const target = process.argv[2];
if (!['node', 'electron'].includes(target)) {
  console.error('usage: rebuild-toggle.js <node|electron>');
  process.exit(1);
}

const cmd = target === 'node'
  ? ['npm', ['rebuild', 'better-sqlite3', '--build-from-source']]
  : ['npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3']];

const r = spawnSync(cmd[0], cmd[1], { stdio: ['ignore', 'ignore', 'inherit'], shell: true });
process.exit(r.status ?? 1);
