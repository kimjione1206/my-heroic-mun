/**
 * 일봉 벌크·증분 수집 + 지표 선계산.
 */

const { getHistoricalCandles } = require('./history-client');
const { computeAll, saveIndicators } = require('./indicators');

async function getLimit() {
  const mod = await import('p-limit');
  return mod.default;
}

// code+period 동시 실행 방지. 같은 키에 대한 요청은 진행 중인 Promise를 공유.
const inflight = new Map();
function withLock(key, fn) {
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try { return await fn(); } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

function saveCandlesBatch(db, code, period, candles) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO candles (code, period, ts, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((arr) => {
    for (const c of arr) stmt.run(code, period, c.timestamp, c.open, c.high, c.low, c.close, c.volume);
  });
  tx(candles);
}

function logSync(db, code, period, status, lastTs, error) {
  db.prepare(`
    INSERT OR REPLACE INTO sync_log (code, period, last_ts, last_run_at, status, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, period, lastTs, Date.now(), status, error || null);
}

function getLastTs(db, code, period) {
  return db.prepare('SELECT last_ts FROM sync_log WHERE code = ? AND period = ?').get(code, period)?.last_ts || 0;
}

async function syncOne(db, stock, opts = {}) {
  const { period = 'D', years = 10, mode = 'full' } = opts;
  const { code, market, name } = stock;
  return withLock(`${code}|${period}`, async () => {
  try {
    const lastTs = mode === 'incremental' ? getLastTs(db, code, period) : 0;
    // 증분: 마지막 동기화 이후 경과 일수 + 여유 7일. 최소 30일, 최대 years.
    let fetchYears = years;
    if (lastTs) {
      const daysGap = (Date.now() - lastTs) / 86400000 + 7;
      fetchYears = Math.min(years, Math.max(30, daysGap) / 365);
    }
    const fresh = await getHistoricalCandles(code, { period, market, years: fetchYears });
    const toSave = lastTs ? fresh.filter((c) => c.timestamp > lastTs) : fresh;

    if (toSave.length === 0) {
      logSync(db, code, period, 'ok', lastTs);
      return { code, name, candles: 0 };
    }

    saveCandlesBatch(db, code, period, toSave);

    // 지표는 항상 전체 재계산 (경계 의존 때문에)
    const allCandles = db.prepare(
      'SELECT ts AS timestamp, open, high, low, close, volume FROM candles WHERE code=? AND period=? ORDER BY ts'
    ).all(code, period);
    const frames = computeAll(allCandles);
    saveIndicators(db, code, period, frames);

    const newLast = toSave[toSave.length - 1].timestamp;
    logSync(db, code, period, 'ok', newLast);
    return { code, name, candles: toSave.length };
  } catch (e) {
    logSync(db, code, period, 'fail', null, e.message);
    return { code, name, error: e.message };
  }
  });
}

async function syncMany(db, stocks, opts = {}) {
  const pLimit = await getLimit();
  const { concurrency = 5, onProgress } = opts;
  const limit = pLimit(concurrency);
  let done = 0;
  const total = stocks.length;
  const tasks = stocks.map((s) =>
    limit(async () => {
      const r = await syncOne(db, s, opts);
      done++;
      onProgress?.({ done, total, current: s.name, error: r.error, candles: r.candles });
      return r;
    })
  );
  return Promise.all(tasks);
}

module.exports = { syncOne, syncMany };
