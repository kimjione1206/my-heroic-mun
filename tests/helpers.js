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

async function launchApp({ openSheet = true } = {}) {
  const exe = findUnpackedExe();
  const env = { ...process.env, MYH_SMOKE: '1', NODE_ENV: 'production' };
  const launchOpts = exe
    ? { executablePath: exe, env, timeout: 30_000 }
    : { args: [path.join(PROJECT_ROOT, 'electron', 'main.js')], env, cwd: PROJECT_ROOT, timeout: 30_000 };

  const app = await _electron.launch(launchOpts);

  const mainLogs = [];
  app.process().stdout.on('data', (d) => mainLogs.push(`[stdout] ${d}`));
  app.process().stderr.on('data', (d) => mainLogs.push(`[stderr] ${d}`));

  const chartWindow = await app.firstWindow();
  const consoleLogs = [];
  chartWindow.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  chartWindow.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

  await chartWindow.waitForLoadState('domcontentloaded');
  await chartWindow.waitForFunction(() => !!window.api, null, { timeout: 20_000 });
  await chartWindow.waitForFunction(() => !!window._testHooks, null, { timeout: 20_000 });

  let sheetWindow = null;
  if (openSheet) {
    const waitForSheet = app.waitForEvent('window');
    await chartWindow.evaluate(() => window.api.openSheetWindow());
    sheetWindow = await waitForSheet;
    await sheetWindow.waitForLoadState('domcontentloaded');
    await sheetWindow.waitForFunction(() => !!window.api, null, { timeout: 20_000 });
  }

  return { app, chartWindow, sheetWindow, mainLogs, consoleLogs };
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
    { timeout: 20_000 }
  );
  await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

module.exports = { launchApp, waitForChartReady, findUnpackedExe };
