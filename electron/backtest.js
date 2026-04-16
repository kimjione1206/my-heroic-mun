/**
 * 패턴 백테스트 엔진.
 * 패턴 hit 일에 진입 → holdDays 후 청산 → 수익률·승률·MDD 집계.
 */

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

/**
 * @param {Array} hits    패턴 detect 결과 [{ timestamp, ... }]
 * @param {Array} candles 해당 종목의 전체 캔들 (시간순)
 * @param {Object} opts   { holdDays, entryAt, exitAt }
 *   entryAt: 'close' (당일 종가) | 'nextOpen' (다음날 시가)
 *   exitAt: 'close' | 'nextOpen'
 * @returns {{ trades, wins, losses, winRate, avgReturn, totalReturn, maxDD, sharpe, samples }}
 */
function runBacktest(hits, candles, opts = {}) {
  const { holdDays = 5, entryAt = 'close', exitAt = 'close' } = opts;
  if (!candles.length || !hits.length) return empty();

  const tsIdx = new Map(candles.map((c, i) => [c.timestamp, i]));
  const trades = [];

  for (const hit of hits) {
    const hitIdx = tsIdx.get(hit.timestamp);
    if (hitIdx == null) continue;

    const entryIdx = entryAt === 'nextOpen' ? hitIdx + 1 : hitIdx;
    const exitIdx = entryIdx + holdDays;
    if (entryIdx >= candles.length || exitIdx >= candles.length) continue;

    const entry = entryAt === 'nextOpen' ? candles[entryIdx].open : candles[hitIdx].close;
    const exit = exitAt === 'nextOpen' ? candles[exitIdx].open : candles[exitIdx].close;
    const ret = (exit - entry) / entry;
    trades.push({
      hitTs: hit.timestamp,
      entryTs: candles[entryIdx].timestamp,
      exitTs: candles[exitIdx].timestamp,
      entry, exit, return: ret,
    });
  }

  return summarize(trades);
}

function empty() {
  return { trades: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, totalReturn: 0, maxDD: 0, bestReturn: 0, worstReturn: 0, samples: [] };
}

function summarize(trades) {
  if (trades.length === 0) return empty();
  const returns = trades.map((t) => t.return);
  const wins = returns.filter((r) => r > 0).length;
  const losses = returns.filter((r) => r < 0).length;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;

  // 에쿼티 곡선(누적 승수) 으로 MDD 계산
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = (equity - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  const sorted = [...returns].sort((a, b) => a - b);
  return {
    trades: trades.length,
    wins, losses,
    winRate: wins / trades.length,
    avgReturn: avg,
    totalReturn: equity - 1,
    maxDD,
    bestReturn: sorted[sorted.length - 1],
    worstReturn: sorted[0],
    median: percentile(sorted, 0.5),
    samples: trades.slice(-20).reverse(),
  };
}

module.exports = { runBacktest };
