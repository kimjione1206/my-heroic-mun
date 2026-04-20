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
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      // 기본: win-unpacked 또는 dev electron 실행 (기존 스위트)
      name: 'default',
      testIgnore: /tests\/installed\//,
    },
    {
      // NSIS 로 silent 설치된 바이너리 대상. CI 의 e2e-win-installed job 에서만 MYH_INSTALLED_EXE 주입돼 실행.
      name: 'installed',
      testMatch: /tests\/installed\/.*\.spec\.js/,
      timeout: 120_000,  // 첫 기동 bootstrap 900MB copy 고려
      retries: 1,
    },
  ],
});
