#!/usr/bin/env node
/**
 * 릴리스용 seed warehouse 구축 파이프라인.
 *
 * 순서:
 *   1) KRX master      (fetch-krx-master)
 *   2) 10년 일봉 수집   (sync-all --years=10)
 *   3) 발행주식수      (fetch-shares)
 *   4) 지표 재계산 후 userData/warehouse.sqlite 를 test/fixtures/release-warehouse.sqlite 로 복사
 *
 * 주의:
 *   - Node ABI 로 native 모듈 재빌드 필요: scripts/rebuild-toggle.js 가 래핑해준다.
 *   - Yahoo 429 리스크 → concurrency=5 로 제한
 *   - 총 수 시간 소요. 릴리스 직전에만 수동 실행.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RELEASE_DB = path.join(ROOT, 'test', 'fixtures', 'release-warehouse.sqlite');

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[${label}] 실패 (exit=${r.status})`);
    process.exit(r.status || 1);
  }
}

async function main() {
  const skipMaster = process.argv.includes('--skip-master');
  const skipShares = process.argv.includes('--skip-shares');
  const yearsArg = process.argv.find((a) => a.startsWith('--years=')) || '--years=10';

  console.log('[prepare-release] 시작:', new Date().toLocaleString('ko-KR'));

  if (!skipMaster) {
    run('KRX master', 'node', ['scripts/fetch-krx-master.js']);
  } else {
    console.log('[prepare-release] KRX master skip');
  }

  run('일봉 10년', 'node', ['scripts/sync-all.js', yearsArg, '--concurrency=5']);

  if (!skipShares) {
    run('발행주식수', 'node', ['scripts/fetch-shares.js']);
  } else {
    console.log('[prepare-release] shares skip');
  }

  const { getUserDataPath } = require('../electron/userdata');
  const userDb = path.join(getUserDataPath(), 'warehouse.sqlite');
  if (!fs.existsSync(userDb)) {
    console.error(`[prepare-release] userData warehouse 없음: ${userDb}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(RELEASE_DB), { recursive: true });
  // WAL checkpoint 후 복사해야 안전
  const Database = require('better-sqlite3');
  const db = new Database(userDb);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  fs.copyFileSync(userDb, RELEASE_DB);
  const size = (fs.statSync(RELEASE_DB).size / (1024 * 1024)).toFixed(1);
  console.log(`\n[prepare-release] ✓ ${RELEASE_DB} (${size} MB) 생성 완료`);
  console.log('[prepare-release] 다음 단계: npm run build (electron-builder)');
}

main().catch((e) => { console.error('[prepare-release] 치명적 실패:', e); process.exit(1); });
