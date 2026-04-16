const PERIODS = [
  { key: 'D', label: '일봉' },
  { key: 'W', label: '주봉' },
  { key: 'M', label: '월봉' },
];

const INDICATORS = [
  { key: 'MA',   label: 'MA',   pane: 'main' },
  { key: 'BOLL', label: '볼린저', pane: 'main' },
  { key: 'EMA',  label: 'EMA',  pane: 'main' },
  { key: 'RSI',  label: 'RSI',  pane: 'sub'  },
  { key: 'MACD', label: 'MACD', pane: 'sub'  },
  { key: 'KDJ',  label: 'KDJ',  pane: 'sub'  },
];

const btn = (active) => ({
  background: active ? '#2a3140' : '#1a1d24',
  color: active ? '#e6e6e6' : '#9aa',
  border: `1px solid ${active ? '#3a4458' : '#2a2f38'}`,
  padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
});

export default function ChartToolbar({ period, onPeriod, indicators, onToggleIndicator }) {
  return (
    <div style={{
      position: 'absolute', top: 8, left: 8, zIndex: 10,
      display: 'flex', gap: 6, background: 'rgba(15,17,21,0.8)',
      padding: 6, borderRadius: 6, backdropFilter: 'blur(4px)',
    }}>
      {PERIODS.map((p) => (
        <button key={p.key} onClick={() => onPeriod(p.key)} style={btn(period === p.key)}>
          {p.label}
        </button>
      ))}
      <div style={{ width: 1, background: '#2a2f38', margin: '0 4px' }} />
      {INDICATORS.map((i) => (
        <button key={i.key} onClick={() => onToggleIndicator(i)} style={btn(indicators[i.key])}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export { INDICATORS };
