#!/usr/bin/env node
/**
 * 전 종목의 발행주식수(sharesOutstanding) 를 Yahoo Finance quoteSummary 로 수집 후
 * warehouse.sqlite 의 stocks.shares_outstanding 에 저장.
 *
 * 사용: node scripts/fetch-shares.js
 *       npm run sync:shares  (rebuild-toggle 포함)
 */

const { getUserDataPath } = require('../electron/userdata');
const { openWarehouse, listStocks, upsertShares } = require('../electron/warehouse');
const { fetchSharesOutstanding } = require('../electron/history-client');

async function getLimit() {
  const mod = await import('p-limit');
  return mod.default;
}

function fmt(n) { return (n || 0).toLocaleString(); }

async function main() {
  const userData = getUserDataPath();
  openWarehouse(userData);
  const stocks = listStocks();
  const total = stocks.length;
  if (total === 0) {
    console.error('[shares] stocks 테이블 비어있음 — 먼저 `npm run sync:master` 실행');
    process.exit(1);
  }

  console.log(`[shares] ${total}종목 sharesOutstanding 수집 시작 (p-limit 5)`);
  const pLimit = await getLimit();
  const limit = pLimit(5);

  let done = 0, ok = 0, fail = 0;
  const batch = [];

  const tasks = stocks.map((s) =>
    limit(async () => {
      try {
        const shares = await fetchSharesOutstanding(s.code, { market: s.market });
        if (shares) {
          batch.push({ code: s.code, shares });
          ok++;
        } else {
          fail++;
        }
      } catch (e) {
        fail++;
        if (process.env.DEBUG) console.error(`[shares] ${s.code} ${s.name} 실패: ${e.message}`);
      }
      done++;
      // 50개 마다 batch flush
      if (batch.length >= 50) {
        upsertShares(batch.splice(0));
      }
      if (done % 100 === 0 || done === total) {
        process.stdout.write(`\r[shares] ${done}/${total} (ok=${ok}, fail=${fail})    `);
      }
    })
  );
  await Promise.all(tasks);
  if (batch.length > 0) upsertShares(batch);

  console.log(`\n[shares] 완료: ok=${fmt(ok)}, fail=${fmt(fail)}, total=${fmt(total)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[shares] fatal:', e);
  process.exit(1);
});
