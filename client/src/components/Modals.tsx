/**
 * One-shot modals and the accusation vault.
 *
 * Every modal carries a unique id issued by the engine. Dismissals are recorded
 * per player and travel with the action log, so a late or duplicated network
 * broadcast can never reopen a dialog the player has already closed.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CARD_BY_ID,
  ROOMS,
  SUSPECTS,
  SUSPECT_BY_ID,
  WEAPONS,
  WEAPON_BY_ID,
  itemName,
} from '@shared/constants.js';
import type { CardKind, MaskedState, ModalPayload } from '@shared/types.js';
import { store } from '../store/gameStore';
import { audio, playCue } from '../audio/audio';
import { WeaponGlyph } from './boardArt';

/* ------------------------------------------------------------------ */
/* Cinematic reveal of the envelope                                    */
/* ------------------------------------------------------------------ */

function EnvelopeFolders({ envelope, guilty }: { envelope: string[]; guilty?: string[] }) {
  const byKind = (kind: CardKind) => envelope.find((c) => CARD_BY_ID[c]?.kind === kind);
  const rows: { kind: CardKind; cardId?: string; glyph: string }[] = [
    { kind: 'suspect', cardId: byKind('suspect'), glyph: '☠' },
    { kind: 'weapon', cardId: byKind('weapon'), glyph: '𖤐' },
    { kind: 'room', cardId: byKind('room'), glyph: '⌂' },
  ];
  return (
    <div className="folders">
      {rows.map((row) => {
        const card = row.cardId ? CARD_BY_ID[row.cardId] : undefined;
        const wrong = guilty && row.cardId ? !guilty.includes(row.cardId) : false;
        return (
          <div className={`folder${wrong ? ' false' : ''}`} key={row.kind}>
            <span className="tab">{row.kind}</span>
            <div className="glyph">
              {row.kind === 'weapon' && card ? (
                <svg viewBox="0 0 24 24" width="42" height="42" style={{ verticalAlign: 'middle' }}>
                  <WeaponGlyph id={card.id.split(':')[1]} color="#241a0d" />
                </svg>
              ) : (
                row.glyph
              )}
            </div>
            <div className="val">{card?.name ?? '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Store-driven modals                                                 */
/* ------------------------------------------------------------------ */

export function StoreModals({ state }: { state: MaskedState }) {
  const modal = state.modals[0];
  useEffect(() => {
    if (!modal) return;
    if (modal.kind === 'solved') playCue('win');
    else if (modal.kind === 'eliminated') playCue('gavel');
    else if (modal.kind === 'unrefuted') playCue('unrefuted');
    else if (modal.kind === 'deal') playCue('deal-many');
  }, [modal?.id]);

  if (!modal) return null;
  const close = () => store.dispatch({ type: 'DISMISS_MODAL', playerId: state.you, modalId: modal.id });

  return (
    <div className="scrim" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {modal.kind === 'deal' ? <DealModal modal={modal} state={state} close={close} /> : null}
        {modal.kind === 'unrefuted' ? <UnrefutedModal modal={modal} state={state} close={close} /> : null}
        {modal.kind === 'eliminated' ? <EliminatedModal modal={modal} close={close} /> : null}
        {modal.kind === 'solved' ? <SolvedModal modal={modal} state={state} close={close} /> : null}
      </div>
    </div>
  );
}

function DealModal({ modal, state, close }: { modal: ModalPayload; state: MaskedState; close: () => void }) {
  const hand = (modal.data.hand as string[]) ?? state.hand;
  return (
    <>
      <div className="modal-head">
        <div className="kicker">Manderley Hall · 11:58 pm</div>
        <h2>YOUR CONFIDENTIAL HAND</h2>
        <div className="hint">Slip these into your notebook — nobody else may see them.</div>
      </div>
      <div className="modal-body">
        <div className="hand" style={{ justifyContent: 'center' }}>
          {hand.map((cardId, i) => {
            const card = CARD_BY_ID[cardId];
            return (
              <div className="card" key={cardId} style={{ animation: `modalin 0.4s ${i * 0.06}s both` }} onClick={() => audio.ink()}>
                <span className="kind">{card?.kind}</span>
                <span className="name">{card?.name}</span>
                {card?.kind === 'weapon' ? (
                  <svg viewBox="0 0 24 24" width="28" height="28">
                    <WeaponGlyph id={card.id.split(':')[1]} color="#2a2116" />
                  </svg>
                ) : (
                  <span className="glyph">{card?.kind === 'room' ? '⌂' : '☠'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn gold" onClick={close}>
          Open the notebook
        </button>
      </div>
    </>
  );
}

function UnrefutedModal({ modal, state, close }: { modal: ModalPayload; state: MaskedState; close: () => void }) {
  const cards = (modal.data.cards as string[]) ?? [];
  const certain = !!modal.data.certain;
  return (
    <>
      <div className="modal-head">
        <div className="waxseal">C</div>
        <div className="kicker">Breakthrough</div>
        <h2>UNREFUTED THEORY</h2>
        <div className="hint">{String(modal.data.text ?? '')}</div>
      </div>
      <div className="modal-body">
        <div className="hand" style={{ justifyContent: 'center' }}>
          {cards.map((cardId) => {
            const card = CARD_BY_ID[cardId];
            return (
              <div className="card" key={cardId}>
                <span className="kind">{card?.kind}</span>
                <span className="name">{card?.name}</span>
                <span className="glyph">?</span>
              </div>
            );
          })}
        </div>
        <div className="divider" />
        <p className="center muted">
          {certain
            ? 'Every one of those three cards is sealed inside the confidential envelope. One accusation ends it.'
            : 'Tick them off in your notebook. The ones already in your hand are accounted for — the rest must be in the envelope.'}
        </p>
      </div>
      <div className="modal-foot">
        {certain && state.accusationReady ? (
          <button
            className="btn crimson"
            onClick={() => {
              // One click, straight to the verdict: all three cards are known to
              // be inside the envelope, so the accusation cannot be wrong.
              store.dispatch({
                type: 'ACCUSE',
                playerId: state.you,
                suspectId: state.accusationReady!.suspectId,
                weaponId: state.accusationReady!.weaponId,
                roomId: state.accusationReady!.roomId,
              });
              playCue('gavel');
              close();
            }}
          >
            ⚖ Accuse at once — they are all in the envelope
          </button>
        ) : null}
        <button className={certain ? 'btn' : 'btn gold'} onClick={close}>
          {certain ? 'Not yet' : 'Understood'}
        </button>
      </div>
    </>
  );
}

function EliminatedModal({ modal, close }: { modal: ModalPayload; close: () => void }) {
  const acc = (modal.data.accusation as string[]) ?? [];
  return (
    <>
      <div className="modal-head">
        <div className="waxseal" style={{ background: 'radial-gradient(circle at 35% 30%, #3a3a3a, #111 62%, #000)' }}>
          ✝
        </div>
        <div className="kicker">Acquitted of nothing</div>
        <h2>CASE DISMISSED</h2>
        <div className="hint">{String(modal.data.text ?? '')}</div>
      </div>
      <div className="modal-body">
        <p className="center muted">
          You accused {acc.map((c) => CARD_BY_ID[c]?.name).filter(Boolean).join(' · ')} — the envelope disagreed.
        </p>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={close}>
          Take a seat in the gallery
        </button>
      </div>
    </>
  );
}

function SolvedModal({ modal, state, close }: { modal: ModalPayload; state: MaskedState; close: () => void }) {
  const envelope = (modal.data.envelope as string[]) ?? state.envelope ?? [];
  const winnerName = String(modal.data.winnerName ?? 'A detective');
  const walkover = !!modal.data.walkover;
  const winnerId = modal.data.winnerId as string | undefined;
  const mine = winnerId === state.you;
  useEffect(() => {
    playCue('seal');
  }, []);
  return (
    <>
      <div className="modal-head">
        <div className="waxseal">⚖</div>
        <div className="kicker">{walkover ? 'Last detective standing' : 'The case is closed'}</div>
        <h2>{mine ? 'YOU SOLVED THE MURDER' : `${winnerName.toUpperCase()} SOLVED THE MURDER`}</h2>
        <div className="hint">
          The three sealed folders are broken open before the assembled company…
        </div>
      </div>
      <div className="modal-body">
        <EnvelopeFolders envelope={envelope} />
        <div className="divider" />
        <p className="center muted">
          {envelope.length
            ? `${CARD_BY_ID[envelope[0]]?.name} did it, with the ${CARD_BY_ID[envelope[1]]?.name?.toLowerCase()}, in the ${
                CARD_BY_ID[envelope[2]]?.name
              }.`
            : ''}
        </p>
      </div>
      <div className="modal-foot">
        <button className="btn gold" onClick={close}>
          Study the evidence
        </button>
        {state.isHost ? (
          <button
            className="btn"
            onClick={() => {
              store.dispatch({ type: 'REMATCH', playerId: state.you });
            }}
          >
            ⟲ Deal a new case
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Accusation Inspection Vault                                         */
/* ------------------------------------------------------------------ */

export function AccusationVault({
  state,
  open,
  prefill,
  onClose,
}: {
  state: MaskedState;
  open: boolean;
  prefill: { suspectId: string; weaponId: string; roomId: string } | null;
  onClose: () => void;
}) {
  const [suspect, setSuspect] = useState<string | null>(prefill?.suspectId ?? null);
  const [weapon, setWeapon] = useState<string | null>(prefill?.weaponId ?? null);
  const [room, setRoom] = useState<string | null>(prefill?.roomId ?? null);

  useEffect(() => {
    if (open) {
      setSuspect(prefill?.suspectId ?? null);
      setWeapon(prefill?.weaponId ?? null);
      setRoom(prefill?.roomId ?? null);
      playCue('shuffle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ready = suspect && weapon && room;
  const roomNameOf = (id: string) => itemName('room', id);

  if (!open) return null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(880px, 100%)' }}>
        <div className="modal-head">
          <div className="kicker">No second chances</div>
          <h2>ACCUSATION INSPECTION VAULT</h2>
          <div className="hint">
            Name the killer, the weapon and the room. Choose wrongly and your investigation ends here — you become a
            witness for the rest of the case.
          </div>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--parchment-dim)' }}>
            The killer is
          </div>
          <div className="tilegrid">
            {SUSPECTS.map((s) => (
              <button
                key={s.id}
                className={`tile${suspect === s.id ? ' sel' : ''}`}
                onClick={() => {
                  setSuspect(s.id);
                  audio.click(1100);
                }}
              >
                <span className="pip" style={{ background: s.color, display: 'inline-block', marginRight: 7, verticalAlign: 'middle' }} />
                {s.name}
                <span className="sub">{s.title}</span>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--parchment-dim)', marginTop: 12 }}>
            With the
          </div>
          <div className="tilegrid">
            {WEAPONS.map((w) => (
              <button
                key={w.id}
                className={`tile${weapon === w.id ? ' sel' : ''}`}
                onClick={() => {
                  setWeapon(w.id);
                  audio.click(1100);
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" style={{ marginRight: 6, verticalAlign: '-2px' }}>
                  <WeaponGlyph id={w.id} color="currentColor" />
                </svg>
                {w.name}
                <span className="sub">last seen in the {roomNameOf(state.weaponLocations[w.id])}</span>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--parchment-dim)', marginTop: 12 }}>
            In the
          </div>
          <div className="tilegrid">
            {ROOMS.map((r) => (
              <button key={r.id} className={`tile${room === r.id ? ' sel' : ''}`} onClick={() => setRoom(r.id)}>
                {r.name}
                <span className="sub">{(state.suspectRooms && Object.entries(state.suspectRooms).some(([k, v]) => v === r.id)) ? 'suspect seen here' : ' '}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="btn crimson"
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              store.dispatch({
                type: 'ACCUSE',
                playerId: state.you,
                suspectId: suspect!,
                weaponId: weapon!,
                roomId: room!,
              });
              playCue('gavel');
              onClose();
            }}
          >
            ⚖ Seal the accusation
          </button>
          <button className="btn ghost" onClick={onClose}>
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Suggestion outcome toast (public knowledge)                         */
/* ------------------------------------------------------------------ */

export function SuggestionBanner({ state }: { state: MaskedState }) {
  const record = state.suggestion;
  const info = useMemo(() => {
    if (!record) return null;
    const suggester = state.players.find((p) => p.id === record.suggesterId);
    const disprover = record.disproverId ? state.players.find((p) => p.id === record.disproverId) : null;
    return { suggester, disprover };
  }, [record, state.players]);
  if (!record || !info) return null;

  return (
    <div className="callout" style={{ margin: '0 14px 10px', position: 'relative' }}>
      <span className="evtag">Exhibit {String(record.turn).padStart(2, '0')}</span>
      <b>{info.suggester?.name}</b> suggests <b>{SUSPECT_BY_ID[record.suspectId]?.name}</b> with the{' '}
      <b>{WEAPON_BY_ID[record.weaponId]?.name}</b> in the <b>{itemName('room', record.roomId)}</b>
      {record.disproverId ? (
        <>
          {' '}
          — <b>{info.disprover?.name}</b> proved the theory false
          {state.you === record.suggesterId || state.you === record.disproverId
            ? ` by showing the ${CARD_BY_ID[record.revealedCardId ?? '']?.name ?? 'card'}.`
            : ' (card kept private).'}
        </>
      ) : record.unrefuted ? (
        <> — <b>nobody could disprove it!</b></>
      ) : (
        <> — the table is checking their cards…</>
      )}
    </div>
  );
}
