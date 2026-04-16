import { useEffect, useRef, useState } from 'react';
import StockSearch from '../components/StockSearch';
import ChartToolbar, { INDICATORS } from '../components/ChartToolbar';
import PatternList from '../components/PatternList';
import BottomPanel from '../components/BottomPanel';
import { registerVolumeRankIndicator, VOLUME_RANK_INDICATOR } from '../lib/volume-rank-indicator';

const DEFAULT_LIST = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
];
const DEFAULT_INDICATORS = { MA: true, BOLL: false, EMA: false, RSI: false, MACD: false, KDJ: false };

export default function Home() {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const indicatorIds = useRef({});
  const overlayIds = useRef([]);
  const [watchlist, setWatchlist] = useState(DEFAULT_LIST);
  const [selected, setSelected] = useState(DEFAULT_LIST[0]);
  const [period, setPeriod] = useState('D');
  const [indicators, setIndicators] = useState(DEFAULT_INDICATORS);
  const [patterns, setPatterns] = useState([]);
  const [enabledPatterns, setEnabledPatterns] = useState(new Set());
  const [hits, setHits] = useState([]);
  const [version, setVersion] = useState('');
  const [dataSource, setDataSource] = useState({ source: '', label: '' });
  const [summary, setSummary] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ running: false, lastSyncAt: null, total: 0 });
  const [syncProg, setSyncProg] = useState(null);

  // test hooks: Playwright 에서 chart 인스턴스/상태 직접 접근
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window._testHooks = {
      getChart: () => chartInstance.current,
      getSelected: () => selected,
      getPeriod: () => period,
      getWatchlist: () => watchlist,
      getPatterns: () => patterns,
      getEnabledPatterns: () => [...enabledPatterns],
      getHits: () => hits,
      getSyncStatus: () => syncStatus,
    };
  });

  useEffect(() => {
    if (!window.api) return;
    window.api.getVersion().then(setVersion);
    window.api.getDataSource().then(setDataSource);
    window.api.listWatchlist().then((list) => {
      if (list.length > 0) { setWatchlist(list); setSelected(list[0]); }
    });
    window.api.listPatterns().then((list) => {
      setPatterns(list);
      setEnabledPatterns(new Set(list.filter((p) => p.defaultEnabled).map((p) => p.id)));
    });
    const offP = window.api.onPatternsChanged(({ list }) => setPatterns(list));
    const refreshStatus = () => window.api.getSyncStatus().then(setSyncStatus);
    refreshStatus();
    const offStart = window.api.onSyncStart((p) => {
      setSyncProg({ done: 0, total: p.total, trigger: p.trigger });
      setSyncStatus((s) => ({ ...s, running: true }));
    });
    const offProg = window.api.onSyncProgress((p) => {
      setSyncProg((prev) => prev ? { ...prev, done: p.done ?? prev.done + 1, total: p.total ?? prev.total } : prev);
    });
    const offDone = window.api.onSyncDone((p) => {
      setSyncProg(null);
      setSyncStatus({ running: false, lastSyncAt: p.at, total: p.total });
    });
    return () => { offP(); offStart(); offProg(); offDone(); };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanupCandles;
    (async () => {
      setLoading(true);
      const kline = await import('klinecharts');
      if (disposed || !chartRef.current) {
        if (chartInstance.current && chartRef.current) {
          try { kline.dispose(chartRef.current); } catch {}
          chartInstance.current = null;
        }
        return;
      }
      if (chartInstance.current) kline.dispose(chartRef.current);
      indicatorIds.current = {};
      overlayIds.current = [];

      registerVolumeRankIndicator(kline);
      const chart = kline.init(chartRef.current, {
        styles: {
          candle: {
            bar: {
              upColor: '#ffffff', downColor: '#ffffff',
              upBorderColor: '#ffffff', downBorderColor: '#ffffff',
              upWickColor: '#ffffff', downWickColor: '#ffffff',
            },
          },
          grid: { horizontal: { color: '#1e222a' }, vertical: { color: '#1e222a' } },
        },
      });
      chart.createIndicator('VOL');
      chart.createIndicator(VOLUME_RANK_INDICATOR, false, { id: 'candle_pane' });
      chartInstance.current = chart;

      for (const ind of INDICATORS) {
        if (indicators[ind.key]) {
          const paneId = ind.pane === 'main'
            ? chart.createIndicator(ind.key, false, { id: 'candle_pane' })
            : chart.createIndicator(ind.key);
          indicatorIds.current[ind.key] = paneId || ind.key;
        }
      }

      const candles = window.api ? await window.api.getCandles(selected.code, period) : [];
      const periodMap = { D: { type: 'day', span: 1 }, W: { type: 'week', span: 1 }, M: { type: 'month', span: 1 } };
      chart.setSymbol({ ticker: selected.code, pricePrecision: 0, volumePrecision: 0 });
      chart.setPeriod(periodMap[period] || periodMap.D);
      chart.setDataLoader({
        getBars: ({ type, callback }) => {
          callback(candles, false);
        },
      });
      updateSummary(candles);
      await renderPatternOverlays(chart, kline);

      if (window.api) {
        let latestCandles = candles;
        cleanupCandles = window.api.onCandlesUpdated(({ code, period: p, candles: fresh }) => {
          if (code === selected.code && p === period) {
            latestCandles = fresh;
            chart.setDataLoader({ getBars: ({ callback }) => callback(fresh, false) });
            updateSummary(fresh);
            renderPatternOverlays(chart, kline);
          }
        });
      }
      setLoading(false);
    })();
    return () => { disposed = true; cleanupCandles?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, period]);

  // 활성 패턴만 바뀌었을 때 오버레이 갱신.
  // selected/period 변경은 위쪽 effect에서 이미 재렌더 처리되므로 여기서 제외.
  useEffect(() => {
    const chart = chartInstance.current;
    if (!chart) return;
    import('klinecharts').then((kline) => {
      if (chartInstance.current === chart) renderPatternOverlays(chart, kline);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledPatterns]);

  async function renderPatternOverlays(chart, kline) {
    if (!window.api) { setHits([]); return; }
    overlayIds.current.forEach((id) => {
      try { chart.removeOverlay(id); } catch {}
    });
    overlayIds.current = [];
    const ids = [...enabledPatterns];
    if (ids.length === 0) { setHits([]); return; }
    const found = await window.api.runEnabledPatterns(ids, selected.code, period);
    setHits(found);
    for (const h of found) {
      if (h.kind !== 'marker') continue;
      const pattern = patterns.find((p) => p.id === h.patternId);
      const color = pattern?.color || '#ffbb00';
      try {
        const id = chart.createOverlay({
          name: 'simpleAnnotation',
          points: [{ timestamp: h.timestamp }],
          extendData: h.symbol || '●',
          styles: {
            text: { color, size: 14, family: 'sans-serif', weight: 'normal' },
          },
        });
        if (id) overlayIds.current.push(id);
      } catch (e) { /* 오버레이 실패는 무시 */ }
    }
  }

  const updateSummary = (candles) => {
    if (!candles || candles.length < 2) { setSummary(null); return; }
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change = last.close - prev.close;
    setSummary({
      last: last.close,
      change: Math.round(change),
      changeRate: +((change / prev.close) * 100).toFixed(2),
      volume: last.volume,
      date: new Date(last.timestamp).toLocaleDateString('ko-KR'),
    });
  };

  const toggleIndicator = (ind) => {
    const chart = chartInstance.current;
    if (!chart) return;
    const enabled = !indicators[ind.key];
    setIndicators((s) => ({ ...s, [ind.key]: enabled }));
    if (enabled) {
      const paneId = ind.pane === 'main'
        ? chart.createIndicator(ind.key, false, { id: 'candle_pane' })
        : chart.createIndicator(ind.key);
      indicatorIds.current[ind.key] = paneId || ind.key;
    } else {
      chart.removeIndicator(indicatorIds.current[ind.key] || ind.key, ind.key);
      delete indicatorIds.current[ind.key];
    }
  };

  const togglePattern = (id) => {
    setEnabledPatterns((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleAdd = async (stock) => {
    if (!window.api) return;
    const list = await window.api.addWatch(stock.code, stock.name);
    setWatchlist(list);
    setSelected(stock);
  };
  const handleRemove = async (code, e) => {
    e.stopPropagation();
    if (!window.api) return;
    const list = await window.api.removeWatch(code);
    setWatchlist(list);
    if (selected.code === code && list.length > 0) setSelected(list[0]);
  };

  return (
    <div className="app">
      <header className="top">
        <span className="title">나만의 영웅문</span>
        <span className="badge">v{version || '0.1.0'}</span>
        <span className="badge" style={{ color: '#52c41a' }}>● {dataSource.label || 'Yahoo Finance'}</span>
        <button onClick={() => setSearchOpen(true)} style={{
          background: '#1a1d24', border: '1px solid #2a2f38', color: '#9aa',
          padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
        }}>🔍 종목 검색 (⌘K)</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9aa', display: 'flex', gap: 10, alignItems: 'center' }}>
          {syncProg ? (
            <span style={{ color: '#ffbb00' }}>
              ⟳ 동기화 {syncProg.done}/{syncProg.total}
              {syncProg.trigger === 'boot' ? ' (부팅)' : ''}
            </span>
          ) : (
            <>
              <span>
                마지막 갱신 {syncStatus.lastSyncAt
                  ? new Date(syncStatus.lastSyncAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                  : '없음'}
              </span>
              <button
                onClick={() => window.api?.runSyncNow()}
                disabled={syncStatus.running}
                style={{
                  background: '#1a1d24', border: '1px solid #2a2f38', color: syncStatus.running ? '#555' : '#9aa',
                  padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: syncStatus.running ? 'default' : 'pointer',
                }}
                title="전 종목 증분 동기화"
              >⟳ 갱신</button>
            </>
          )}
          <span>{selected.name} ({selected.code}) · {period === 'D' ? '일봉' : period === 'W' ? '주봉' : '월봉'}</span>
        </span>
      </header>

      <aside className="left">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="title">관심종목 ({watchlist.length})</span>
          <button onClick={() => setSearchOpen(true)} style={{
            background: 'transparent', border: '1px solid #333', color: '#9aa',
            padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
          }}>+ 추가</button>
        </div>
        {watchlist.map((t) => (
          <div key={t.code} className="ticker-row" onClick={() => setSelected(t)}
               style={{ background: selected.code === t.code ? '#1a1d24' : 'transparent' }}>
            <span>{t.name}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#9aa', fontSize: 11 }}>{t.code}</span>
              <button onClick={(e) => handleRemove(t.code, e)} style={{
                background: 'transparent', border: 'none', color: '#555', cursor: 'pointer',
                fontSize: 14, padding: '0 4px',
              }} title="삭제">×</button>
            </span>
          </div>
        ))}

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #222' }}>
          <div className="title" style={{ marginBottom: 8 }}>활성 패턴 ({enabledPatterns.size})</div>
          <PatternList patterns={patterns} enabled={enabledPatterns} onToggle={togglePattern} />
          <div style={{ marginTop: 8, fontSize: 10, color: '#555', lineHeight: 1.5 }}>
            patterns/ 폴더 편집 시 자동 리로드
          </div>
        </div>
      </aside>

      <main className="main">
        <ChartToolbar
          period={period} onPeriod={setPeriod}
          indicators={indicators} onToggleIndicator={toggleIndicator}
        />
        <div ref={chartRef} className="chart" data-testid="kline-chart" />
        {loading && (
          <div style={{ position: 'absolute', top: 60, right: 16, fontSize: 11, color: '#9aa' }}>
            데이터 로딩 중...
          </div>
        )}
      </main>

      <aside className="right">
        <div className="title" style={{ marginBottom: 8 }}>종목 정보</div>
        {summary ? (
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {Math.round(summary.last).toLocaleString()}
              <span style={{ fontSize: 11, color: '#9aa', marginLeft: 6 }}>원</span>
            </div>
            <div className={summary.change >= 0 ? 'up' : 'down'} style={{ fontSize: 13 }}>
              {summary.change > 0 ? '▲' : summary.change < 0 ? '▼' : '–'} {Math.abs(summary.change).toLocaleString()}
              ({summary.changeRate > 0 ? '+' : ''}{summary.changeRate}%)
            </div>
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #222', color: '#9aa' }}>
              <div>기준일 {summary.date}</div>
              <div>거래량 {summary.volume.toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#666' }}>데이터 없음</div>
        )}

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #222' }}>
          <div className="title" style={{ marginBottom: 8 }}>감지된 패턴 ({hits.length})</div>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {hits.length === 0 ? (
              <div style={{ fontSize: 11, color: '#555' }}>아직 감지된 패턴 없음</div>
            ) : (
              [...hits].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30).map((h, i) => {
                const p = patterns.find((x) => x.id === h.patternId);
                return (
                  <div key={i} style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px dashed #1e222a' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: p?.color || '#ffbb00' }}>{h.symbol} {p?.name || h.patternId}</span>
                      <span style={{ color: '#666' }}>{new Date(h.timestamp).toLocaleDateString('ko-KR')}</span>
                    </div>
                    <div style={{ color: '#9aa', fontSize: 10, marginTop: 2 }}>{h.label}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>

      <footer className="bottom">
        <BottomPanel
          code={selected.code}
          patterns={patterns}
          getSnapshot={() => ({
            selected, period, indicators,
            watchlistCodes: watchlist.map((w) => w.code),
            enabledPatternIds: [...enabledPatterns],
          })}
          applySnapshot={(s) => {
            if (s.selected) setSelected(s.selected);
            if (s.period) setPeriod(s.period);
            if (s.indicators) setIndicators(s.indicators);
            if (s.enabledPatternIds) setEnabledPatterns(new Set(s.enabledPatternIds));
          }}
        />
      </footer>

      <StockSearch open={searchOpen} onClose={() => setSearchOpen(false)} onPick={handleAdd} />
    </div>
  );
}
