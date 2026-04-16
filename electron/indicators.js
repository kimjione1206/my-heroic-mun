/**
 * 보조지표 선계산.
 * 모든 함수는 순수(입력→출력) 이며 NaN 위치는 null 로 채운다.
 */

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    prev = prev == null ? v : v * k + prev * (1 - k);
    if (i >= period - 1) out[i] = prev;
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function bollinger(closes, period = 20, mult = 2) {
  const upper = new Array(closes.length).fill(null);
  const mid   = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  // sliding sum + sum-of-squares로 O(N). 표준편차는 E[x²]-E[x]²
  let sum = 0, sqSum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    sqSum += closes[i] * closes[i];
    if (i >= period) {
      sum -= closes[i - period];
      sqSum -= closes[i - period] * closes[i - period];
    }
    if (i >= period - 1) {
      const m = sum / period;
      const variance = Math.max(0, sqSum / period - m * m);
      const std = Math.sqrt(variance);
      mid[i] = m;
      upper[i] = m + mult * std;
      lower[i] = m - mult * std;
    }
  }
  return { upper, mid, lower };
}

function macd(closes) {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const line = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const valid = line.map((v) => (v == null ? 0 : v));
  const signal = ema(valid, 9).map((v, i) => (line[i] == null ? null : v));
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

function computeAll(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ma5   = sma(closes, 5);
  const ma20  = sma(closes, 20);
  const ma60  = sma(closes, 60);
  const ma120 = sma(closes, 120);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const rsi14 = rsi(closes, 14);
  const bb    = bollinger(closes, 20, 2);
  const m     = macd(closes);
  const volMA = sma(volumes, 20).map((v) => (v == null ? null : Math.round(v)));

  return candles.map((c, i) => ({
    code: null, period: null, ts: c.timestamp,
    ma5: ma5[i], ma20: ma20[i], ma60: ma60[i], ma120: ma120[i],
    ema12: ema12[i], ema26: ema26[i],
    rsi14: rsi14[i],
    bb_upper: bb.upper[i], bb_mid: bb.mid[i], bb_lower: bb.lower[i],
    macd: m.line[i], macd_signal: m.signal[i], macd_hist: m.hist[i],
    vol_ma20: volMA[i],
  }));
}

function saveIndicators(db, code, period, frames) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO indicators
      (code, period, ts, ma5, ma20, ma60, ma120, ema12, ema26, rsi14,
       bb_upper, bb_mid, bb_lower, macd, macd_signal, macd_hist, vol_ma20)
    VALUES (@code, @period, @ts, @ma5, @ma20, @ma60, @ma120, @ema12, @ema26, @rsi14,
            @bb_upper, @bb_mid, @bb_lower, @macd, @macd_signal, @macd_hist, @vol_ma20)
  `);
  const tx = db.transaction((arr) => {
    for (const f of arr) stmt.run({ ...f, code, period });
  });
  tx(frames);
}

module.exports = { computeAll, saveIndicators, sma, ema, rsi, bollinger, macd };
