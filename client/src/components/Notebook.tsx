/**
 * The detective's notebook — a slide-out leather-and-parchment clue sheet.
 *
 * Stamps the player taps are kept in the host's authoritative state; stamps the
 * deduction engine can prove (✓ a card you have seen, ✗ a card ruled out) are
 * applied automatically with an ink scratch.
 */
import { useEffect, useRef, useState } from 'react';
import { ROOMS, SUSPECTS, WEAPONS, itemName } from '@shared/constants.js';
import { knowledgeFromMask } from '@shared/deduction.js';
import type { CardKind, MaskedState, NotebookStamp } from '@shared/types.js';
import { store } from '../store/gameStore';
import { audio } from '../audio/audio';

interface Props {
  state: MaskedState;
  open: boolean;
  onClose: () => void;
}

const KIND_LABEL: Record<CardKind, string> = {
  suspect: 'Suspects',
  weapon: 'Weapons',
  room: 'Rooms',
};

export function Notebook({ state, open, onClose }: Props) {
  const knowledge = knowledgeFromMask(state);
  const [stamps, setStamps] = useState<Record<string, NotebookStamp>>(state.notebook ?? {});
  const [scratch, setScratch] = useState(state.notes ?? '');
  const scratchDirty = useRef(false);
  const lastAuto = useRef<string>('');
  const scratchRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Save straight from the live DOM value. Reading React state here would use
   * the render that created the handler, which is one keystroke behind when a
   * player types and tabs away (or hits save) in the same tick.
   */
  const saveScratch = (value?: string) => {
    const text = value ?? scratchRef.current?.value ?? '';
    scratchDirty.current = false;
    store.dispatch({ type: 'SET_SCRATCH', playerId: state.you, text });
  };

  // Follow the authoritative notebook whenever the host sends a fresh copy.
  useEffect(() => {
    if (!scratchDirty.current) setStamps((s) => ({ ...s, ...(state.notebook ?? {}) }));
  }, [state.notebook, state.version]);

  // Auto-stamp everything the engine can prove, once per new version.
  useEffect(() => {
    if (lastAuto.current === `${state.version}`) return;
    lastAuto.current = `${state.version}`;
    const next = { ...state.notebook };
    let changed = false;
    for (const item of knowledge.clearedItems) {
      if (next[item] !== 'cleared') {
        next[item] = 'cleared';
        changed = true;
      }
    }
    for (const item of knowledge.ruledOutItems) {
      if (next[item] !== 'cleared' && next[item] !== 'ruled') {
        next[item] = 'ruled';
        changed = true;
      }
    }
    if (changed) {
      setStamps(next);
      audio.ink();
    }
  }, [state.version, state.notebook, knowledge]);

  useEffect(() => {
    if (!scratchDirty.current) setScratch(state.notes ?? '');
  }, [state.notes]);

  /**
   * Tapping a stamp marks the item with it; tapping the stamp already showing
   * rubs it out again. Predictable, and it matches what the buttons look like.
   */
  const mark = (item: string, target: NotebookStamp) => {
    const current = stamps[item] ?? 'unknown';
    const next: NotebookStamp = current === target ? 'unknown' : target;
    setStamps((s) => ({ ...s, [item]: next }));
    audio.stamp();
    store.dispatch({ type: 'SET_NOTE', playerId: state.you, item, stamp: next });
  };



  const rows = (kind: CardKind) => {
    const items = kind === 'suspect' ? SUSPECTS.map((s) => ({ id: s.id, name: s.name, color: s.color }))
      : kind === 'weapon' ? WEAPONS.map((w) => ({ id: w.id, name: w.name, color: '#8a6d3b' }))
      : ROOMS.map((r) => ({ id: r.id, name: r.name, color: '#6b4a1c' }));
    return items.map((it) => {
      const stamp = stamps[it.id] ?? 'unknown';
      // Facts the engine has already proved are locked, so a tap can never fight
      // the evidence and appear to do nothing.
      const proved = knowledge.clearedItems.has(it.id);
      const struck = knowledge.ruledOutItems.has(it.id);
      const locked = proved || struck;
      return (
        <div className="nb-row" key={it.id}>
          <span
            className="pip"
            style={{ background: it.color, width: 14, height: 14 }}
            aria-hidden
          />
          <span className={`nm${stamp === 'ruled' ? ' struck' : ''}`}>{it.name}</span>
          <div className="stampr" title={proved ? 'You have seen this card' : struck ? 'This card cannot be in the envelope' : undefined}>
            <button
              type="button"
              className={`stamp cleared${stamp === 'cleared' ? ' on' : ''}`}
              title="Confirmed innocent — I have seen this card"
              onClick={() => mark(it.id, 'cleared')}
              disabled={locked}
              style={locked ? { opacity: 0.85, cursor: 'default' } : undefined}
            >
              ✓
            </button>
            <button
              type="button"
              className={`stamp suspected${stamp === 'suspected' ? ' on' : ''}`}
              title={locked ? 'Already accounted for' : 'Mark as a live theory'}
              onClick={() => mark(it.id, 'suspected')}
              disabled={locked}
              style={locked ? { opacity: 0.35, cursor: 'default' } : undefined}
            >
              ?
            </button>
            <button
              type="button"
              className={`stamp ruled${stamp === 'ruled' ? ' on' : ''}`}
              title={locked ? 'Already accounted for' : 'Strike out — this card is accounted for elsewhere'}
              onClick={() => mark(it.id, 'ruled')}
              disabled={locked}
              style={locked ? { opacity: 0.35, cursor: 'default' } : undefined}
            >
              ✗
            </button>
          </div>
        </div>
      );
    });
  };

  return (
    <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="notebook">
        <header className="notebook-head">
          <span className="nb-seal" aria-hidden>
            C
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.34em', textTransform: 'uppercase', color: '#6b4a1c' }}>
              Case File № 1924
            </div>
            <h2>DETECTIVE NOTEBOOK</h2>
          </div>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="notebook-body">
          {(['suspect', 'weapon', 'room'] as CardKind[]).map((kind) => (
            <div className="nb-group" key={kind}>
              <h3>{KIND_LABEL[kind]}</h3>
              {rows(kind)}
            </div>
          ))}
          <div className="nb-legend">
            <span>
              <b>✓</b> seen — innocent
            </span>
            <span>
              <b>?</b> theory
            </span>
            <span>
              <b>✗</b> struck out
            </span>
          </div>
          {Object.keys(knowledge.certain).length === 3 ? (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                border: '1.5px solid rgba(122,28,28,0.6)',
                background: 'rgba(122,28,28,0.09)',
                borderRadius: 3,
                fontFamily: 'var(--typewriter)',
                fontSize: 14,
              }}
            >
              <b>THE CASE IS SOLVED.</b> You have cornered every card:{' '}
              {(['suspect', 'weapon', 'room'] as CardKind[])
                .map((k) => itemName(k, knowledge.certain[k] as string))
                .join(' · ')}
              . Make your final accusation.
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#5c4a2a' }}>
                <b>Still unaccounted for:</b> {knowledge.candidates.suspect.length} suspects ·{' '}
                {knowledge.candidates.weapon.length} weapons · {knowledge.candidates.room.length} rooms.
                {knowledge.certain.suspect || knowledge.certain.weapon || knowledge.certain.room ? (
                  <>
                    {' '}
                    Certain of:{' '}
                    {(['suspect', 'weapon', 'room'] as CardKind[])
                      .filter((k) => knowledge.certain[k])
                      .map((k) => `${itemName(k, knowledge.certain[k] as string)} (${k})`)
                      .join(', ')}
                    .
                  </>
                ) : null}
              </div>
            </div>
          )}
          <div className="scratch">
            <h3 style={{ fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#6b4a1c' }}>
              Notes
            </h3>
            <textarea
              ref={scratchRef}
              value={scratch}
              placeholder="Who had the opportunity? Where were the servants at midnight?…"
              onChange={(e) => {
                scratchDirty.current = true;
                setScratch(e.target.value);
                if (e.target.value.length % 12 === 0) audio.typeKey();
              }}
              onBlur={(e) => saveScratch(e.currentTarget.value)}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn small"
                onClick={() => {
                  saveScratch();
                  store.setNotice('Notes saved.');
                }}
              >
                Save notes
              </button>
              <span style={{ fontSize: 12, color: '#5c4a2a' }}>auto-saved when you leave the page</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
