module.exports = {
  id: 'rsi-oversold-rebound',
  name: 'RSI 과매도 반등',
  description: 'RSI14 가 30 아래에서 반등하며 다시 30 위로 올라온 지점',
  color: '#faad14',
  defaultEnabled: true,

  detect(candles, indicators) {
    const hits = [];
    for (let i = 2; i < candles.length; i++) {
      const prev = indicators[i - 1]?.rsi14;
      const cur = indicators[i]?.rsi14;
      if (prev == null || cur == null) continue;
      if (prev < 30 && cur >= 30) {
        hits.push({
          timestamp: candles[i].timestamp,
          kind: 'marker',
          symbol: '↗',
          label: `RSI ${prev.toFixed(1)} → ${cur.toFixed(1)}`,
          score: 30 - prev,
        });
      }
    }
    return hits;
  },
};
