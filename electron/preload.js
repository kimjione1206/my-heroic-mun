const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const h = (_e, d) => cb(d);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('api', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  getDataSource: () => ipcRenderer.invoke('app:data-source'),

  getCandles: (code, period = 'D') => ipcRenderer.invoke('candles:get', { code, period }),
  getIndicators: (code, period = 'D') => ipcRenderer.invoke('indicators:get', { code, period }),

  searchStocks: (q) => ipcRenderer.invoke('stocks:search', q),

  // Market cap sheet
  getMarketCapStatus: () => ipcRenderer.invoke('marketcap:status'),
  getMarketCapDates: (limit) => ipcRenderer.invoke('marketcap:dates', { limit }),
  getMarketCapRanking: (params) => ipcRenderer.invoke('marketcap:ranking', params),
  ensureShares: () => ipcRenderer.invoke('shares:ensure'),

  listSheetColumns: () => ipcRenderer.invoke('sheet:columns:list'),
  addSheetColumn: (args) => ipcRenderer.invoke('sheet:columns:add', args),
  removeSheetColumn: (key) => ipcRenderer.invoke('sheet:columns:remove', key),
  reorderSheetColumns: (keys) => ipcRenderer.invoke('sheet:columns:reorder', keys),
  setSheetCell: (args) => ipcRenderer.invoke('sheet:cell:set', args),

  listPatterns: () => ipcRenderer.invoke('patterns:list'),
  runPattern: (id, code, period = 'D') => ipcRenderer.invoke('patterns:run', { id, code, period }),
  runEnabledPatterns: (enabledIds, code, period = 'D') =>
    ipcRenderer.invoke('patterns:run-enabled', { enabledIds, code, period }),

  runBacktest: (params) => ipcRenderer.invoke('backtest:run', params),

  listNotes: (code) => ipcRenderer.invoke('notes:list', code),
  addNote: (code, ts, text, tags) => ipcRenderer.invoke('notes:add', { code, ts, text, tags }),
  removeNote: (id) => ipcRenderer.invoke('notes:remove', id),

  saveWorkspace: (name, config) => ipcRenderer.invoke('workspace:save', { name, config }),
  loadWorkspace: (name) => ipcRenderer.invoke('workspace:load', name),
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  deleteWorkspace: (name) => ipcRenderer.invoke('workspace:delete', name),

  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  runSyncNow: () => ipcRenderer.invoke('sync:run-now'),

  // 멀티 윈도우 선택 동기화
  selectStock: (stock) => ipcRenderer.invoke('window:select-stock', stock),
  openSheetWindow: () => ipcRenderer.invoke('window:open-sheet'),
  isSheetOpen: () => ipcRenderer.invoke('window:is-sheet-open'),
  onExternalSelectStock: (cb) => on('external:select-stock', cb),

  onCandlesUpdated: (cb) => on('candles:updated', cb),
  onPatternsChanged: (cb) => on('patterns:changed', cb),
  onSyncProgress: (cb) => on('sync:progress', cb),
  onSyncStart: (cb) => on('sync:start', cb),
  onSyncDone: (cb) => on('sync:done', cb),
  onSharesStart: (cb) => on('shares:start', cb),
  onSharesProgress: (cb) => on('shares:progress', cb),
  onSharesDone: (cb) => on('shares:done', cb),
  onSheetBlocked: (cb) => on('sheet:blocked', cb),
  onSyncSkipped: (cb) => on('sync:skipped', cb),
});
