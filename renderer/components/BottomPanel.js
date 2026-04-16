import { useEffect, useState } from 'react';

const TABS = [
  { key: 'backtest', label: '백테스트' },
  { key: 'notes', label: '메모' },
  { key: 'workspaces', label: '워크스페이스' },
];

const tabBtn = (on) => ({
  background: on ? '#2a3140' : 'transparent', color: on ? '#e6e6e6' : '#9aa',
  border: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  borderBottom: `2px solid ${on ? '#ffbb00' : 'transparent'}`,
});

const input = {
  background: '#0f1115', border: '1px solid #2a2f38', color: '#e6e6e6',
  padding: '4px 8px', borderRadius: 4, fontSize: 12, outline: 'none',
};

function Backtest({ code, patterns }) {
  const [patternId, setPatternId] = useState(null);
  const [holdDays, setHoldDays] = useState(5);
  const [entryAt, setEntryAt] = useState('nextOpen');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!patternId && patterns.length > 0) setPatternId(patterns[0].id);
  }, [patterns, patternId]);

  const run = async () => {
    if (!window.api || !patternId) return;
    setRunning(true);
    const r = await window.api.runBacktest({ patternId, code, holdDays: +holdDays, entryAt });
    setResult(r);
    setRunning(false);
  };

  const fmt = (n, digits = 2) => (n == null ? '-' : (n * 100).toFixed(digits) + '%');
  const pos = (n) => n >= 0 ? '#ff4d4f' : '#4d9cff';

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
        <label style={{ fontSize: 10, color: '#9aa' }}>패턴</label>
        <select style={input} value={patternId || ''} onChange={(e) => setPatternId(e.target.value)}>
          {patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label style={{ fontSize: 10, color: '#9aa', marginTop: 6 }}>보유일 (holdDays)</label>
        <input style={input} type="number" min="1" max="60" value={holdDays} onChange={(e) => setHoldDays(e.target.value)} />
        <label style={{ fontSize: 10, color: '#9aa', marginTop: 6 }}>진입 시점</label>
        <select style={input} value={entryAt} onChange={(e) => setEntryAt(e.target.value)}>
          <option value="close">감지 당일 종가</option>
          <option value="nextOpen">다음날 시가</option>
        </select>
        <button onClick={run} disabled={running} style={{
          marginTop: 8, background: '#ffbb00', color: '#111', border: 'none',
          padding: '6px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: 600,
        }}>{running ? '실행 중...' : '백테스트 실행'}</button>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, alignContent: 'start' }}>
        {result ? <>
          <Cell label="감지 횟수" value={result.hits} />
          <Cell label="거래 수" value={result.result.trades} />
          <Cell label="승률" value={fmt(result.result.winRate)} color={pos(result.result.winRate - 0.5)} />
          <Cell label="평균 수익" value={fmt(result.result.avgReturn)} color={pos(result.result.avgReturn)} />
          <Cell label="누적 수익" value={fmt(result.result.totalReturn)} color={pos(result.result.totalReturn)} />
          <Cell label="최대 손실" value={fmt(result.result.maxDD)} color="#4d9cff" />
          <Cell label="최고 거래" value={fmt(result.result.bestReturn)} color="#ff4d4f" />
          <Cell label="최악 거래" value={fmt(result.result.worstReturn)} color="#4d9cff" />
        </> : (
          <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#666' }}>
            좌측에서 조건 선택 후 "백테스트 실행" 클릭. 현재 종목의 해당 패턴 감지 지점에서 다음날 시가 매수 → N일 뒤 종가 매도 시뮬레이션.
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, color = '#e6e6e6' }) {
  return (
    <div style={{ background: '#14171d', border: '1px solid #222', padding: 8, borderRadius: 4 }}>
      <div style={{ fontSize: 10, color: '#9aa', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Notes({ code }) {
  const [notes, setNotes] = useState([]);
  const [ts, setTs] = useState('');
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');

  const reload = async () => {
    if (!window.api) return;
    setNotes(await window.api.listNotes(code));
  };
  useEffect(() => { reload(); }, [code]);

  const add = async () => {
    if (!text.trim() || !window.api) return;
    const d = ts ? new Date(ts).getTime() : Date.now();
    await window.api.addNote(code, d, text, tags);
    setText(''); setTags(''); setTs('');
    reload();
  };
  const remove = async (id) => {
    await window.api.removeNote(id);
    reload();
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
        <label style={{ fontSize: 10, color: '#9aa' }}>날짜 (비우면 오늘)</label>
        <input style={input} type="date" value={ts} onChange={(e) => setTs(e.target.value)} />
        <label style={{ fontSize: 10, color: '#9aa' }}>메모</label>
        <input style={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 실적 발표 직전" />
        <label style={{ fontSize: 10, color: '#9aa' }}>태그 (쉼표 구분)</label>
        <input style={input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="실적, 이벤트" />
        <button onClick={add} style={{
          marginTop: 4, background: '#52c41a', color: '#111', border: 'none',
          padding: '6px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: 600,
        }}>+ 메모 추가</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {notes.length === 0 ? (
          <div style={{ fontSize: 11, color: '#666' }}>아직 메모 없음</div>
        ) : notes.map((n) => (
          <div key={n.id} style={{
            padding: '6px 8px', borderBottom: '1px dashed #222', fontSize: 12,
            display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 8, alignItems: 'center',
          }}>
            <span style={{ color: '#9aa', fontSize: 11 }}>{new Date(n.ts).toLocaleDateString('ko-KR')}</span>
            <span>
              <span style={{ color: '#e6e6e6' }}>{n.text}</span>
              {n.tags && <span style={{ color: '#ffbb00', fontSize: 10, marginLeft: 6 }}>#{n.tags}</span>}
            </span>
            <button onClick={() => remove(n.id)} style={{
              background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14,
            }} title="삭제">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Workspaces({ getSnapshot, applySnapshot }) {
  const [ws, setWs] = useState([]);
  const [name, setName] = useState('');

  const reload = async () => { if (window.api) setWs(await window.api.listWorkspaces()); };
  useEffect(() => { reload(); }, []);

  const save = async () => {
    if (!name.trim() || !window.api) return;
    const snap = getSnapshot();
    await window.api.saveWorkspace(name, snap);
    setName('');
    reload();
  };
  const load = async (n) => {
    const cfg = await window.api.loadWorkspace(n);
    if (cfg) applySnapshot(cfg);
  };
  const remove = async (n) => {
    await window.api.deleteWorkspace(n);
    reload();
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
        <label style={{ fontSize: 10, color: '#9aa' }}>새 워크스페이스 이름</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 단타-모니터링" />
        <button onClick={save} style={{
          marginTop: 4, background: '#4d9cff', color: '#fff', border: 'none',
          padding: '6px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: 600,
        }}>💾 현재 상태 저장</button>
        <div style={{ fontSize: 10, color: '#666', marginTop: 6, lineHeight: 1.5 }}>
          활성 패턴·관심종목·선택종목·타임프레임·보조지표를 하나의 프리셋으로 저장
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {ws.length === 0 ? (
          <div style={{ fontSize: 11, color: '#666' }}>저장된 워크스페이스 없음</div>
        ) : ws.map((w) => (
          <div key={w.name} style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 80px auto', gap: 8, alignItems: 'center',
            padding: '6px 8px', borderBottom: '1px dashed #222', fontSize: 12,
          }}>
            <span>{w.name}</span>
            <span style={{ color: '#666', fontSize: 10 }}>{new Date(w.updated_at).toLocaleDateString('ko-KR')}</span>
            <button onClick={() => load(w.name)} style={{
              background: '#2a3140', border: '1px solid #3a4458', color: '#e6e6e6',
              padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
            }}>불러오기</button>
            <button onClick={() => remove(w.name)} style={{
              background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14,
            }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BottomPanel({ code, patterns, getSnapshot, applySnapshot }) {
  const [tab, setTab] = useState('backtest');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #222', marginBottom: 8 }}>
        {TABS.map((t) => (
          <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'backtest' && <Backtest code={code} patterns={patterns} />}
        {tab === 'notes' && <Notes code={code} />}
        {tab === 'workspaces' && <Workspaces getSnapshot={getSnapshot} applySnapshot={applySnapshot} />}
      </div>
    </div>
  );
}
