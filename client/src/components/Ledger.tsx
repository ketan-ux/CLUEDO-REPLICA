import { useEffect, useRef } from 'react';
import type { MaskedState } from '@shared/types.js';

export function Ledger({ state }: { state: MaskedState }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const entries = state.log.slice(-90);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.log.length]);

  return (
    <section className="panel ledger">
      <div className="panel-title">
        Investigation Ledger
        <span className="rule" />
        <span style={{ letterSpacing: '0.1em', textTransform: 'none' }}>
          {state.phase === 'GAME_OVER' ? 'case closed' : `turn ${state.turn}`}
        </span>
      </div>
      <div className="ledger-scroll" ref={scroller}>
        {entries.map((e) => (
          <div key={e.id} className={`ledger-entry ${e.tone ?? ''}`}>
            <span className="turn">
              turn {e.turn} · {new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {e.visibleTo ? ' · private' : ''}
            </span>
            {e.text}
          </div>
        ))}
        {!entries.length ? (
          <div className="ledger-entry muted">
            <span className="turn">awaiting</span>
            The ledger is blank. Something wicked is about to be written in it.
          </div>
        ) : null}
      </div>
    </section>
  );
}
