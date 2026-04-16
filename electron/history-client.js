const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

function toYahooSymbol(code, market) {
  // KOSPI → .KS, KOSDAQ → .KQ
  const suffix = market === 'KOSDAQ' ? '.KQ' : '.KS';
  return `${code}${suffix}`;
}

const PERIOD_TO_INTERVAL = { D: '1d', W: '1wk', M: '1mo' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimitErr(e) {
  const msg = e?.message || '';
  return e?.code === 429 || /429|rate limit|too many requests/i.test(msg);
}

async function fetchWithRetry(symbol, opts, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await yahooFinance.chart(symbol, opts);
    } catch (e) {
      lastErr = e;
      if (attempt === maxRetries || !isRateLimitErr(e)) throw e;
      // 지수 백오프: 500ms, 1500ms, 4500ms
      await sleep(500 * Math.pow(3, attempt));
    }
  }
  throw lastErr;
}

async function getHistoricalCandles(code, { period = 'D', market = 'KOSPI', years = 3 } = {}) {
  const symbol = toYahooSymbol(code, market);
  const end = new Date();
  const start = new Date(end.getTime() - years * 365 * 86400000);
  const rows = await fetchWithRetry(symbol, {
    period1: start,
    period2: end,
    interval: PERIOD_TO_INTERVAL[period] || '1d',
  });
  const quotes = rows?.quotes || [];
  return quotes
    .filter((q) => q.open != null && q.close != null)
    .map((q) => ({
      timestamp: new Date(q.date).getTime(),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume || 0,
    }));
}

module.exports = { getHistoricalCandles, toYahooSymbol };
