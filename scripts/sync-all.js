#!/usr/bin/env node
/**
 * 전 종목 × N년 일봉 최초 구축 + 증분 CLI.
 *
 * 사용:
 *   node scripts/sync-all.js                   # 전 종목 10년치 full
 *   node scripts/sync-all.js --years=5         # 5년
 *   node scripts/sync-all.js --limit=50        # 처음 50개만 (파일럿)
 *   node scripts/sync-all.js --market=KOSPI    # KOSPI 만
 *   node scripts/sync-all.js --mode=incremental # 최근만 갱신
 *   node scripts/sync-all.js --concurrency=8   # 병렬 수
 */

const fs = require('fs');
const { getUserDataPath } = require('../electron/userdata');
const { openWarehouse, listStocks, countStocks } = require('../electron/warehouse');
const { syncMany } = require('../electron/sync');

function arg(key, def) {
  const found = process.argv.find((a) => a.startsWith(`--${key}=`));
  return found ? found.split('=')[1] : def;
}

async function main() {
  const years       = parseInt(arg('years', '10'), 10);
  const limit       = parseInt(arg('limit', '0'), 10);
  const concurrency = parseInt(arg('concurrency', '5'), 10);
  const market      = arg('market', null);
  const mode        = arg('mode', 'full');

  const userData = getUserDataPath();
  fs.mkdirSync(userData, { recursive: true });
  const db = openWarehouse(userData);

  if (countStocks() === 0) {
    console.error('[sync] stocks 테이블 비어있음. `npm run sync:master` 먼저 실행하세요.');
    process.exit(1);
  }

  let stocks = listStocks(market);
  if (limit > 0) stocks = stocks.slice(0, limit);

  console.log(`[sync] ${stocks.length}개 종목 × ${years}년 (${mode}, concurrency=${concurrency})`);
  const t0 = Date.now();
  let errors = 0;

  const isTTY = process.stdout.isTTY;
  await syncMany(db, stocks, {
    mode, period: 'D', years, concurrency,
    onProgress: ({ done, total, current, error, candles }) => {
      if (error) errors++;
      if (isTTY) {
        const pct = ((done / total) * 100).toFixed(1);
        const tag = error ? '✗' : `✓ ${candles}`;
        process.stdout.write(`\r[${done}/${total}] ${pct}% · ${current.padEnd(18).slice(0, 18)} · ${tag}         `);
      } else if (done % 100 === 0 || done === total || error) {
        const pct = ((done / total) * 100).toFixed(1);
        console.log(`[${done}/${total}] ${pct}%${error ? ` · ✗ ${current}: ${error}` : ''}`);
      }
    },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[sync] ✓ ${elapsed}s, 성공 ${stocks.length - errors}, 실패 ${errors}`);
}

main().catch((e) => { console.error('[sync] 치명적 실패:', e); process.exit(1); });
