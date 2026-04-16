module.exports = {
  id: 'dead-cross',
  name: '데드크로스',
  description: '5일선이 20일선을 위에서 아래로 이탈',
  color: '#4d9cff',
  defaultEnabled: false,

  detect(candles, indicators) {
    const hits = [];
    for (let i = 21; i < candles.length; i++) {
      const p = indicators[i - 1];
      const c = indicators[i];
      if (!p?.ma5 || !p?.ma20 || !c?.ma5 || !c?.ma20) continue;
      if (p.ma5 >= p.ma20 && c.ma5 < c.ma20) {
        hits.push({
          timestamp: candles[i].timestamp,
          kind: 'marker',
          symbol: '▼',
          label: '데드크로스 (5 < 20)',
          score: (c.ma20 - c.ma5) / c.ma20,
        });
      }
    }
    return hits;
  },
};
