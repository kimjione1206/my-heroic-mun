module.exports = {
  id: 'bb-breakout',
  name: '볼린저 상단 돌파',
  description: '종가가 볼린저밴드 상단(20, 2σ) 을 돌파',
  color: '#ff4d4f',
  defaultEnabled: false,

  detect(candles, indicators) {
    const hits = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const ind = indicators[i];
      const pind = indicators[i - 1];
      if (!ind?.bb_upper || !pind?.bb_upper) continue;
      if (p.close <= pind.bb_upper && c.close > ind.bb_upper) {
        const over = (c.close - ind.bb_upper) / ind.bb_upper;
        hits.push({
          timestamp: c.timestamp,
          kind: 'marker',
          symbol: '🚀',
          label: `상단 돌파 (+${(over * 100).toFixed(2)}%)`,
          score: over,
        });
      }
    }
    return hits;
  },
};
