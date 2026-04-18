import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';

const MarketCapSheet = dynamic(() => import('../components/MarketCapSheet'), { ssr: false });

export default function SheetPage() {
  const [selected, setSelected] = useState({ code: '', name: '' });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // test hooks (Playwright)
    window._testHooks = {
      getSelected: () => selected,
    };
  });

  // 차트 창에서 선택이 바뀌면 여기도 반영 (row 하이라이트)
  useEffect(() => {
    if (!window.api?.onExternalSelectStock) return;
    const off = window.api.onExternalSelectStock((s) => {
      if (s?.code && s?.name) setSelected(s);
    });
    return () => off?.();
  }, []);

  return (
    <>
      <Head>
        <title>시총 순위 — 나만의 영웅문</title>
      </Head>
      <div className="sheet-app">
        <header className="sheet-top">
          <span className="title">시총 순위</span>
          {selected.code && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9aa' }}>
              차트: {selected.name} ({selected.code})
            </span>
          )}
        </header>
        <main className="sheet-body">
          <MarketCapSheet
            selectedCode={selected.code}
            onSelect={(s) => {
              setSelected(s);
              window.api?.selectStock?.(s);
            }}
          />
        </main>
      </div>
    </>
  );
}
