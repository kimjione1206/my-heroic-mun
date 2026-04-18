// 일봉(D) 캔들 배열을 주봉(W)/월봉(M)으로 집계한다.
// 네트워크 없이 로컬 DB의 10년치 일봉을 즉시 상위 주기로 변환.

function ymd(ts) {
  const d = new Date(ts);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
}

// ISO 주 기준(월요일 시작). 같은 주면 같은 키.
function weekKey(ts) {
  const d = new Date(ts);
  // 해당 날짜가 속한 주의 월요일 UTC 타임스탬프
  const day = d.getUTCDay() || 7; // 1=Mon, 7=Sun
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
  return monday.getTime();
}

function monthKey(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function aggregate(daily, keyFn) {
  if (!daily || daily.length === 0) return [];
  const buckets = new Map();
  for (const c of daily) {
    const k = keyFn(c.timestamp);
    const b = buckets.get(k);
    if (!b) {
      buckets.set(k, { timestamp: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
    } else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;            // 마지막 close
      b.volume += c.volume || 0;
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function toWeekly(daily) { return aggregate(daily, weekKey); }
function toMonthly(daily) { return aggregate(daily, monthKey); }

module.exports = { toWeekly, toMonthly };
