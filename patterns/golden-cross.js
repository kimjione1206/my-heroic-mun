module.exports = {
  id: 'golden-cross',
  name: '골든크로스',
  description: '5일선이 20일선을 아래에서 위로 돌파',
  color: '#52c41a',
  defaultEnabled: true,

  detect(candles, indicators) {
    const hits = [];
    for (let i = 21; i < candles.length; i++) {
      const p = indicators[i - 1];
      const c = indicators[i];
      if (!p?.ma5 || !p?.ma20 || !c?.ma5 || !c?.ma20) continue;
      if (p.ma5 <= p.ma20 && c.ma5 > c.ma20) {
        hits.push({
          timestamp: candles[i].timestamp,
          kind: 'marker',
          symbol: '▲',
          label: '골든크로스 (5 > 20)',
          score: (c.ma5 - c.ma20) / c.ma20,
        });
      }
    }
    return hits;
  },
};
