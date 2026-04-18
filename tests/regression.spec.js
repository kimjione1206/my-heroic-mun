// Level 3 — 회귀 방지 (이전 발견 이슈들)
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

test('[reg-1] 첫 진입 시 거래량 순위 색상 적용 (전부 흰색 아님)', async () => {
  const { app, window } = await launchApp();
  try {
    await waitForChartReady(window);
    // 2프레임 추가 대기 (indicator 생성 직후 draw 완료)
    await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // canvas 픽셀 샘플링: 빨강/주황/노랑 중 하나가 존재하는지
    const hasColor = await window.evaluate(() => {
      const canvas = document.querySelector('[data-testid="kline-chart"] canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const img = ctx.getImageData(0, 0, w, h).data;
      // 5%씩 샘플링해 색상 hit 카운트
      let red = 0, orange = 0, yellow = 0;
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          const R = img[i], G = img[i + 1], B = img[i + 2];
          if (R > 200 && G < 120 && B < 120) red++;
          else if (R > 220 && G > 120 && G < 180 && B < 80) orange++;
          else if (R > 200 && G > 180 && B < 100) yellow++;
        }
      }
      return { red, orange, yellow, total: red + orange + yellow };
    });
    expect(hasColor && (hasColor.total > 0)).toBeTruthy();
  } finally {
    await app.close();
  }
});

test('[reg-2] 창 리사이즈 시 캔들 수 유지 + chart.resize 호출 가능', async () => {
  const { app, window } = await launchApp();
  try {
    await waitForChartReady(window);
    const before = await window.evaluate(() => window._testHooks.getChart().getDataList().length);
    await window.setViewportSize({ width: 1280, height: 720 });
    await window.waitForTimeout(500);
    const after = await window.evaluate(() => window._testHooks.getChart().getDataList().length);
    expect(after).toBe(before);
    const canResize = await window.evaluate(() => typeof window._testHooks.getChart().resize === 'function');
    expect(canResize).toBeTruthy();
  } finally {
    await app.close();
  }
});

test('[reg-3] 주봉(W) 전환 → 캔들 수가 일봉보다 작음 (집계)', async () => {
  const { app, window } = await launchApp();
  try {
    await waitForChartReady(window);
    const daily = await window.evaluate(() => window._testHooks.getChart().getDataList().length);
    // IPC로 직접 주봉 조회 — UI 토글 selector 의존성 없이 검증
    const weekly = await window.evaluate(() => window.api.getCandles('005930', 'W'));
    expect(Array.isArray(weekly)).toBeTruthy();
    expect(weekly.length).toBeLessThan(daily);
    expect(weekly.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test('[reg-4] 월봉(M) 전환 → 주봉보다 더 작은 캔들 수', async () => {
  const { app, window } = await launchApp();
  try {
    await waitForChartReady(window);
    const weekly = await window.evaluate(() => window.api.getCandles('005930', 'W'));
    const monthly = await window.evaluate(() => window.api.getCandles('005930', 'M'));
    expect(monthly.length).toBeLessThanOrEqual(weekly.length);
    expect(monthly.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
