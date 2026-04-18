// Level 3 — 회귀 방지 (차트 창 대상)
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

test('[reg-1] 첫 진입 시 거래량 순위 색상 적용', async () => {
  const { app, chartWindow } = await launchApp({ openSheet: false });
  try {
    await waitForChartReady(chartWindow);
    await chartWindow.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const hit = await chartWindow.evaluate(() => {
      const canvas = document.querySelector('[data-testid="kline-chart"] canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const img = ctx.getImageData(0, 0, w, h).data;
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
    expect(hit && hit.total > 0).toBeTruthy();
  } finally {
    await app.close();
  }
});

test('[reg-2] 창 리사이즈 시 chart.resize 호출 가능', async () => {
  const { app, chartWindow } = await launchApp({ openSheet: false });
  try {
    await waitForChartReady(chartWindow);
    await chartWindow.setViewportSize({ width: 1280, height: 720 });
    await chartWindow.waitForTimeout(500);
    const canResize = await chartWindow.evaluate(() =>
      typeof window._testHooks.getChart().resize === 'function'
    );
    expect(canResize).toBeTruthy();
    const len = await chartWindow.evaluate(() => window._testHooks.getChart().getDataList().length);
    expect(len).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test('[reg-3] 주봉(W) 집계 — 일봉보다 작음', async () => {
  const { app, chartWindow } = await launchApp({ openSheet: false });
  try {
    await waitForChartReady(chartWindow);
    const daily = await chartWindow.evaluate(() => window._testHooks.getChart().getDataList().length);
    const weekly = await chartWindow.evaluate(() => window.api.getCandles('005930', 'W'));
    expect(Array.isArray(weekly)).toBeTruthy();
    expect(weekly.length).toBeLessThan(daily);
    expect(weekly.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test('[reg-4] 월봉(M) 집계 — 주봉보다 더 작음', async () => {
  const { app, chartWindow } = await launchApp({ openSheet: false });
  try {
    await waitForChartReady(chartWindow);
    const weekly = await chartWindow.evaluate(() => window.api.getCandles('005930', 'W'));
    const monthly = await chartWindow.evaluate(() => window.api.getCandles('005930', 'M'));
    expect(monthly.length).toBeLessThanOrEqual(weekly.length);
    expect(monthly.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
