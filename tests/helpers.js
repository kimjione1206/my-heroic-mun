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
  const launchOpts = exe
    ? { executablePath: exe, env, timeout: 30_000 }
    : { args: [path.join(PROJECT_ROOT, 'electron', 'main.js')], env, cwd: PROJECT_ROOT, timeout: 30_000 };

  const app = await _electron.launch(launchOpts);

  // main stdout/stderr 수집 (실패 시 진단용)
  const mainLogs = [];
  app.process().stdout.on('data', (d) => mainLogs.push(`[stdout] ${d}`));
  app.process().stderr.on('data', (d) => mainLogs.push(`[stderr] ${d}`));

  const window = await app.firstWindow();
  const consoleLogs = [];
  window.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  window.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

  await window.waitForLoadState('domcontentloaded');

  // 단계별 진단 — 실패 위치 명확히
  try {
    await window.waitForFunction(() => !!window.api, null, { timeout: 20_000 });
  } catch (e) {
    const dump = await dumpState(window, mainLogs, consoleLogs);
    throw new Error(`window.api 미노출 (preload 로드 실패 추정)\n${dump}`);
  }

  try {
    await window.waitForFunction(() => !!window._testHooks, null, { timeout: 20_000 });
  } catch (e) {
    const dump = await dumpState(window, mainLogs, consoleLogs);
    throw new Error(`window._testHooks 미노출 (React 마운트 실패 추정)\n${dump}`);
  }

  return { app, window };
}

async function dumpState(window, mainLogs, consoleLogs) {
  const url = window.url();
  const title = await window.title().catch(() => '???');
  const bodyText = await window.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '');
  const hasApi = await window.evaluate(() => typeof window.api).catch(() => 'eval-failed');
  const hasHooks = await window.evaluate(() => typeof window._testHooks).catch(() => 'eval-failed');
  return [
    `url=${url}`, `title=${title}`,
    `typeof window.api=${hasApi}`, `typeof window._testHooks=${hasHooks}`,
    `bodyText=${JSON.stringify(bodyText)}`,
    `--- main logs ---`, ...mainLogs.slice(-30),
    `--- console ---`, ...consoleLogs.slice(-30),
  ].join('\n');
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
