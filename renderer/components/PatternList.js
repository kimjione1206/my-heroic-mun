export default function PatternList({ patterns, enabled, onToggle }) {
  if (!patterns?.length) {
    return <div style={{ fontSize: 11, color: '#555', padding: 8 }}>patterns/ 폴더가 비어있음</div>;
  }
  return (
    <div>
      {patterns.map((p) => {
        const on = enabled.has(p.id);
        return (
          <div key={p.id} onClick={() => onToggle(p.id)} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 8px', cursor: 'pointer', borderRadius: 4,
            background: on ? '#1a1d24' : 'transparent',
            borderLeft: `3px solid ${on ? p.color : 'transparent'}`,
          }}
          onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = '#15181e'; }}
          onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
          title={p.description}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: on ? '#e6e6e6' : '#9aa' }}>{p.name}</span>
              <span style={{ fontSize: 10, color: '#666' }}>{p.description}</span>
            </div>
            <span style={{ fontSize: 10, color: on ? p.color : '#444' }}>{on ? '●' : '○'}</span>
          </div>
        );
      })}
    </div>
  );
}
