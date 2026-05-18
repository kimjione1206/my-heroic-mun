// 뷰포트 거래량 비율에 따라 캔들 색을 흰색 → 분홍 → 진빨강 그라데이션으로 덮어 그린다.
// ratio = volume / maxVol (0~1). ratio=0 → 흰색(255,255,255), ratio=1 → 진빨강(255,0,0).
// 선형 보간: G·B 채널만 (1-ratio)에 비례해 줄이고 R은 255 고정.

export const VOLUME_RANK_INDICATOR = 'volumeRankCandle';

let registered = false;

function colorFor(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  const gb = Math.round(255 * (1 - r));
  return `rgb(255,${gb},${gb})`;
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

      // 매 캔들마다 색이 달라지므로 그룹화 없이 한 개씩 그린다.
      for (let i = from; i < to; i++) {
        const k = dataList[i];
        if (!k || k.volume == null) continue;
        const color = colorFor(k.volume / maxVol);

        const x = Math.round(xAxis.convertToPixel(i));
        const yOpen = yAxis.convertToPixel(k.open);
        const yClose = yAxis.convertToPixel(k.close);
        const top = Math.round(Math.min(yOpen, yClose));
        const bodyH = Math.max(1, Math.round(Math.abs(yClose - yOpen)));

        ctx.fillStyle = color;
        ctx.fillRect(x - half, top, half * 2, bodyH);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, Math.round(yAxis.convertToPixel(k.high)));
        ctx.lineTo(x + 0.5, Math.round(yAxis.convertToPixel(k.low)));
        ctx.stroke();
      }
      return false;
    },
    figures: [],
  });
  registered = true;
}
