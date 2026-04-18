import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';

const FIXED_COLS = [
  { key: '__rank', label: '#', width: 44, align: 'right' },
  { key: '__name', label: '종목명', width: 110, align: 'left' },
  { key: '__code', label: '코드', width: 60, align: 'right' },
  { key: '__close', label: '종가', width: 72, align: 'right' },
  { key: '__cap', label: '시총', width: 84, align: 'right' },
];

const ROW_H = 26;
const HEADER_H = 30;

function fmtWon(n) {
  if (n == null) return '-';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
  if (n >= 1e8) return `${Math.round(n / 1e8)}억`;
  return Math.round(n).toLocaleString();
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export default function MarketCapSheet({ selectedCode, onSelect }) {
  const [dates, setDates] = useState([]);
  const [selectedTs, setSelectedTs] = useState(null);
  const [market, setMarket] = useState('ALL');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [status, setStatus] = useState(null);
  const [height, setHeight] = useState(400);
  const [addColOpen, setAddColOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!window.api) return;
    let cancel = false;
    (async () => {
      const [statusRes, datesRes] = await Promise.all([
        window.api.getMarketCapStatus(),
        window.api.getMarketCapDates(500),
      ]);
      if (cancel) return;
      setStatus(statusRes);
      setDates(datesRes);
      if (datesRes.length > 0) setSelectedTs(datesRes[0]);
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (!window.api) return;
    const offStart = window.api.onSharesStart?.(() => {
      setStatus((s) => ({ ...(s || {}), running: true }));
    });
    const offDone = window.api.onSharesDone?.(async () => {
      const [statusRes, datesRes] = await Promise.all([
        window.api.getMarketCapStatus(),
        window.api.getMarketCapDates(500),
      ]);
      setStatus(statusRes);
      setDates(datesRes);
      if (datesRes.length > 0) setSelectedTs((cur) => cur || datesRes[0]);
    });
    return () => { offStart?.(); offDone?.(); };
  }, []);

  const loadRanking = useCallback(async () => {
    if (!window.api || !selectedTs) return;
    const res = await window.api.getMarketCapRanking({
      ts: selectedTs,
      market: market === 'ALL' ? undefined : market,
      search: search || undefined,
      limit: 3000,
      offset: 0,
    });
    setRows(res.rows || []);
    setColumns(res.columns || []);
  }, [selectedTs, market, search]);

  useEffect(() => { loadRanking(); }, [loadRanking]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setHeight(Math.max(200, el.clientHeight - HEADER_H - 38));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allCols = useMemo(() => {
    const custom = columns.map((c) => ({
      key: c.key, label: c.label, type: c.type, width: 70, align: 'right', custom: true,
    }));
    return [...FIXED_COLS, ...custom];
  }, [columns]);

  const totalWidth = allCols.reduce((s, c) => s + c.width, 0) + 22;  // + padding

  const Row = ({ index, style }) => {
    const r = rows[index];
    if (!r) return null;
    const isSelected = r.code === selectedCode;
    return (
      <div
        data-testid="rank-row"
        data-code={r.code}
        onClick={() => onSelect?.({ code: r.code, name: r.name })}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          fontSize: 11,
          cursor: 'pointer',
          background: isSelected ? '#1a1d24' : 'transparent',
          borderBottom: '1px solid #14171d',
          paddingLeft: 4, paddingRight: 4,
          color: isSelected ? '#fff' : '#d8dde4',
        }}
      >
        {allCols.map((col) => {
          let content = null;
          if (col.key === '__rank') content = r.rank;
          else if (col.key === '__name') content = r.name;
          else if (col.key === '__code') content = r.code;
          else if (col.key === '__close') content = r.close ? Math.round(r.close).toLocaleString() : '-';
          else if (col.key === '__cap') content = fmtWon(r.market_cap);
          else if (col.custom) {
            const v = r.cells?.[col.key] ?? '';
            return (
              <EditableCell
                key={col.key}
                value={v}
                type={col.type}
                width={col.width}
                onCommit={async (newV) => {
                  await window.api.setSheetCell({ code: r.code, columnKey: col.key, value: newV });
                  // 로컬 상태 반영
                  setRows((prev) => prev.map((x) => x.code === r.code
                    ? { ...x, cells: { ...(x.cells || {}), [col.key]: newV } }
                    : x));
                }}
              />
            );
          }
          return (
            <div key={col.key} style={{
              width: col.width,
              textAlign: col.align || 'left',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              padding: '0 4px',
            }}>
              {content}
            </div>
          );
        })}
      </div>
    );
  };

  const onAddColumn = async (label, type) => {
    const key = slugify(label);
    if (!key) return;
    const updated = await window.api.addSheetColumn({ key, label, type });
    setColumns(updated);
    await loadRanking();
    setAddColOpen(false);
  };

  const onRemoveColumn = async (key) => {
    if (!confirm(`컬럼 "${key}" 를 삭제할까요? 모든 입력값이 지워집니다.`)) return;
    const updated = await window.api.removeSheetColumn(key);
    setColumns(updated);
    await loadRanking();
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', flexWrap: 'wrap' }}>
        <select
          data-testid="date-select"
          value={selectedTs || ''}
          onChange={(e) => setSelectedTs(Number(e.target.value))}
          style={selStyle}
        >
          {dates.map((t) => <option key={t} value={t}>{fmtDate(t)}</option>)}
        </select>
        <select value={market} onChange={(e) => setMarket(e.target.value)} style={selStyle}>
          <option value="ALL">전체</option>
          <option value="KOSPI">KOSPI</option>
          <option value="KOSDAQ">KOSDAQ</option>
        </select>
        <input
          placeholder="검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...selStyle, flex: 1, minWidth: 60 }}
        />
        <button
          data-testid="add-column-btn"
          onClick={() => setAddColOpen(true)}
          style={btnStyle}
          title="커스텀 컬럼 추가"
        >+ 컬럼</button>
      </div>

      {status && !status.ready && (
        <div style={{ padding: '4px 8px', fontSize: 10, color: '#ffbb00' }}>
          {status.running
            ? `시총 데이터 수집 중... (${status.withShares}/${status.total})`
            : '시총 데이터 준비되지 않음. `npm run sync:shares` 실행 필요'}
        </div>
      )}

      {/* 헤더 */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', height: HEADER_H,
          fontSize: 10, fontWeight: 700, color: '#9aa',
          borderBottom: '1px solid #2a2f38', background: '#0f1115',
          minWidth: totalWidth,
        }}>
          {allCols.map((col) => (
            <div
              key={col.key}
              onContextMenu={col.custom ? (e) => { e.preventDefault(); onRemoveColumn(col.key); } : undefined}
              style={{
                width: col.width, textAlign: col.align || 'left',
                padding: '0 4px', whiteSpace: 'nowrap',
                color: col.custom ? '#ffbb00' : '#9aa',
                cursor: col.custom ? 'context-menu' : 'default',
              }}
              title={col.custom ? '우클릭: 컬럼 삭제' : undefined}
            >
              {col.label}
            </div>
          ))}
        </div>

        <List
          height={height}
          itemCount={rows.length}
          itemSize={ROW_H}
          width={Math.max(totalWidth, 200)}
          style={{ overflowX: 'hidden' }}
        >
          {Row}
        </List>
      </div>

      {rows.length === 0 && status?.ready && (
        <div style={{ padding: 12, fontSize: 11, color: '#666' }}>
          해당 날짜에 표시할 데이터 없음
        </div>
      )}

      {addColOpen && <AddColumnModal onSubmit={onAddColumn} onClose={() => setAddColOpen(false)} />}
    </div>
  );
}

function EditableCell({ value, type, width, onCommit }) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setV(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (String(v) !== String(value)) onCommit(v);
  };

  if (type === 'bool') {
    return (
      <div style={{ width, textAlign: 'center', padding: '0 4px' }} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={v === 'true' || v === true}
          onChange={(e) => { const nv = e.target.checked ? 'true' : ''; setV(nv); onCommit(nv); }}
        />
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        style={{
          width, textAlign: type === 'number' ? 'right' : 'left',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          padding: '0 4px', color: v ? '#e6e6e6' : '#555',
        }}
      >
        {v || '…'}
      </div>
    );
  }

  return (
    <input
      autoFocus
      type={type === 'number' ? 'number' : 'text'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setV(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: width - 4, height: ROW_H - 4,
        background: '#1a1d24', color: '#fff',
        border: '1px solid #2a2f38', borderRadius: 2,
        fontSize: 11, padding: '0 3px', outline: 'none',
        textAlign: type === 'number' ? 'right' : 'left',
      }}
    />
  );
}

function AddColumnModal({ onSubmit, onClose }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="add-column-modal"
        style={{
          background: '#14171d', border: '1px solid #2a2f38', borderRadius: 6,
          padding: 16, width: 300, display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>새 컬럼 추가</div>
        <label style={{ fontSize: 10, color: '#9aa' }}>이름</label>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="예: 목표가"
          data-testid="new-column-label"
          style={{ ...selStyle }}
          onKeyDown={(e) => e.key === 'Enter' && label && onSubmit(label, type)}
        />
        <label style={{ fontSize: 10, color: '#9aa' }}>타입</label>
        <select value={type} onChange={(e) => setType(e.target.value)} style={selStyle}>
          <option value="text">텍스트</option>
          <option value="number">숫자</option>
          <option value="bool">체크박스</option>
        </select>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={btnStyle}>취소</button>
          <button
            onClick={() => label && onSubmit(label, type)}
            style={{ ...btnStyle, background: '#ffbb00', color: '#111' }}
            data-testid="add-column-submit"
          >추가</button>
        </div>
      </div>
    </div>
  );
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9ㄱ-ㅎㅏ-ㅣ가-힣_]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32) || `col_${Date.now().toString(36).slice(-5)}`;
}

const selStyle = {
  background: '#1a1d24',
  border: '1px solid #2a2f38',
  color: '#e6e6e6',
  padding: '3px 6px',
  borderRadius: 3,
  fontSize: 11,
  outline: 'none',
};
const btnStyle = {
  background: '#2a3140',
  border: '1px solid #3a4458',
  color: '#e6e6e6',
  padding: '3px 8px',
  borderRadius: 3,
  fontSize: 11,
  cursor: 'pointer',
};
