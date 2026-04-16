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

  listWatchlist: () => ipcRenderer.invoke('watchlist:list'),
  addWatch: (code, name) => ipcRenderer.invoke('watchlist:add', { code, name }),
  removeWatch: (code) => ipcRenderer.invoke('watchlist:remove', code),
  reorderWatch: (codes) => ipcRenderer.invoke('watchlist:reorder', codes),

  searchStocks: (q) => ipcRenderer.invoke('stocks:search', q),

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

  onCandlesUpdated: (cb) => on('candles:updated', cb),
  onPatternsChanged: (cb) => on('patterns:changed', cb),
  onSyncProgress: (cb) => on('sync:progress', cb),
  onSyncStart: (cb) => on('sync:start', cb),
  onSyncDone: (cb) => on('sync:done', cb),
});
