const path = require('path');
const fs = require('fs');
const { _electron } = require('@playwright/test');

const PROJECT_ROOT = path.join(__dirname, '..');

function findUnpackedExe() {
  if (process.env.EXE_PATH) return process.env.EXE_PATH;
  const dir = path.join(PROJECT_ROOT, 'dist', 'win-unpacked');
  if (!fs.existsSync(dir)) return null;
  const exe = fs.readdirSync(dir).find((f) => f.endsWith('.exe'));
  return exe ? path.join(dir, exe) : null;
}

async function launchApp() {
  const exe = findUnpackedExe();
  const env = { ...process.env, MYH_SMOKE: '1', NODE_ENV: 'production' };

  let app;
  if (exe) {
    // CI: packaged exe 사용
    app = await _electron.launch({ executablePath: exe, env, timeout: 30_000 });
  } else {
    // 로컬 개발: electron . 로 기동
    app = await _electron.launch({
      args: [path.join(PROJECT_ROOT, 'electron', 'main.js')],
      env,
      cwd: PROJECT_ROOT,
      timeout: 30_000,
    });
  }

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => window.api && window._testHooks, null, { timeout: 15_000 });
  return { app, window };
}

async function waitForChartReady(window) {
  await window.waitForFunction(
    () => {
      const chart = window._testHooks?.getChart?.();
      if (!chart) return false;
      const data = chart.getDataList?.();
      return Array.isArray(data) && data.length > 0;
    },
    null,
    { timeout: 15_000 }
  );
  // canvas 렌더 2프레임 대기 (Windows 소프트웨어 렌더 안정화)
  await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

module.exports = { launchApp, waitForChartReady, findUnpackedExe };
