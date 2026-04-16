import { useEffect, useRef, useState } from 'react';

export default function StockSearch({ open, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (!open || !window.api) return;
    window.api.searchStocks(q).then(setResults);
  }, [q, open]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
      display: 'flex', justifyContent: 'center', paddingTop: 120,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 480, maxHeight: '60vh', background: '#14171d', border: '1px solid #2a2f38',
        borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column',
      }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="종목명 또는 코드 검색 (예: 삼성, 005930)"
          style={{
            background: '#0f1115', border: '1px solid #2a2f38', color: '#e6e6e6',
            padding: '10px 12px', borderRadius: 6, fontSize: 14, outline: 'none',
          }} onKeyDown={(e) => e.key === 'Escape' && onClose()} />

        <div style={{ overflow: 'auto', marginTop: 8 }}>
          {results.length === 0 && (
            <div style={{ padding: 16, color: '#666', fontSize: 12 }}>결과 없음</div>
          )}
          {results.map((s) => (
            <div key={s.code} onClick={() => { onPick(s); onClose(); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1d24')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span>{s.name}</span>
              <span style={{ color: '#888', fontSize: 11 }}>{s.code} · {s.market}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
