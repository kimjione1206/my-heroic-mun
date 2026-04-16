module.exports = {
  id: 'volume-spike',
  name: '거래량 급증',
  description: '20일 평균 대비 3배 이상 거래량',
  color: '#ff6b35',
  defaultEnabled: true,

  detect(candles, indicators) {
    const hits = [];
    for (let i = 20; i < candles.length; i++) {
      const c = candles[i];
      const avg = indicators[i]?.vol_ma20;
      if (!avg) continue;
      const ratio = c.volume / avg;
      if (ratio >= 3) {
        hits.push({
          timestamp: c.timestamp,
          kind: 'marker',
          symbol: '🔥',
          label: `거래량 ${ratio.toFixed(1)}배`,
          score: ratio,
        });
      }
    }
    return hits;
  },
};
