const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  globalTimeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,                               // Electron 단일 창 강제
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
    ...(process.env.CI ? [['github']] : []),
  ],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // trace: 모든 테스트마다 저장 — 내부에 액션별 스크린샷 시퀀스 포함 (Claude가 unzip 후 PNG 순차 Read)
    trace: 'on',
    // 실패 순간 최종 상태 PNG (빠른 진단용)
    screenshot: 'only-on-failure',
    // 비디오는 Claude가 읽을 수 없어 제거 (trace 내 스크린샷 시퀀스로 대체)
    video: 'off',
  },
});
