// 뷰포트 거래량 순위에 따라 캔들 바 색을 덮어 그리는 커스텀 인디케이터.
// ≥80% 빨강 / ≥60% 주황 / ≥40% 노랑 / 그 외는 기본(흰색) 캔들 유지.

export const VOLUME_RANK_INDICATOR = 'volumeRankCandle';

const THRESHOLDS = [
  { min: 0.8, color: '#ff4d4f' },
  { min: 0.6, color: '#ff9500' },
  { min: 0.4, color: '#ffd400' },
];

let registered = false;

function colorFor(ratio) {
  for (const t of THRESHOLDS) if (ratio >= t.min) return t.color;
  return null;
}

export function registerVolumeRankIndicator(kline) {
  if (registered) return;
  kline.registerIndicator({
    name: VOLUME_RANK_INDICATOR,
    shortName: '',
    series: 'price',
    shouldOhlc: false,
    calc: () => [],
    draw: ({ ctx, chart, xAxis, yAxis }) => {
      const dataList = chart.getDataList();
      const vr = chart.getVisibleRange();
      if (!vr || !dataList || dataList.length === 0) return false;

      const from = Math.max(0, vr.from);
      const to = Math.min(dataList.length, vr.to);
      if (to - from < 1) return false;

      let maxVol = 0;
      for (let i = from; i < to; i++) {
        const v = dataList[i]?.volume ?? 0;
        if (v > maxVol) maxVol = v;
      }
      if (maxVol <= 0) return false;

      const bs = chart.getBarSpace();
      const half = Math.max(1, bs.halfGapBar || bs.halfBar || 3);

      // 색상별로 바디(rect)와 심지(line) 좌표를 누적한 뒤 한 번에 flush.
      const groups = new Map();  // color -> { bodies: [], wicks: [] }
      for (let i = from; i < to; i++) {
        const k = dataList[i];
        if (!k || k.volume == null) continue;
        const color = colorFor(k.volume / maxVol);
        if (!color) continue;

        const x = Math.round(xAxis.convertToPixel(i));
        const yOpen = yAxis.convertToPixel(k.open);
        const yClose = yAxis.convertToPixel(k.close);
        const top = Math.round(Math.min(yOpen, yClose));
        const bodyH = Math.max(1, Math.round(Math.abs(yClose - yOpen)));

        let g = groups.get(color);
        if (!g) { g = { bodies: [], wicks: [] }; groups.set(color, g); }
        g.bodies.push([x - half, top, half * 2, bodyH]);
        g.wicks.push([x + 0.5, Math.round(yAxis.convertToPixel(k.high)), Math.round(yAxis.convertToPixel(k.low))]);
      }

      for (const [color, g] of groups) {
        ctx.fillStyle = color;
        for (const [x, y, w, h] of g.bodies) ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [x, yHigh, yLow] of g.wicks) {
          ctx.moveTo(x, yHigh);
          ctx.lineTo(x, yLow);
        }
        ctx.stroke();
      }
      return false;
    },
    figures: [],
  });
  registered = true;
}
