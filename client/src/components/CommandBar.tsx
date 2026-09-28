/**
 * Dossier Command Bar — the desk in front of the active detective.
 *
 * It shows whose turn it is, which phase the investigation has reached, and the
 * one or two buttons that are legal right now: roll the dice (or duck through a
 * secret passage), propose a theory, hand over a card, or seal a final
 * accusation.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CARD_BY_ID,
  ROOM_BY_ID,
  SUSPECTS,
  SUSPECT_BY_ID,
  WEAPONS,
  WEAPON_BY_ID,
  itemIdOf,
} from '@shared/constants.js';
import { secretPassageTarget } from '@shared/board.js';
import type { MaskedState } from '@shared/types.js';
import { store } from '../store/gameStore';
import { initialsOf, suspectOf, useMe } from '../hooks/useGame';
import { audio } from '../audio/audio';
import { WeaponGlyph } from './boardArt';

interface Props {
  state: MaskedState;
  onAccuse: () => void;
}

const PHASE_TEXT: Record<string, string> = {
  LOBBY: 'Waiting',
  ROLL: 'Roll the dice',
  MOVE: 'Move',
  SUGGEST: 'Propose a theory',
  DISPROVE: 'Answer the query',
  ACCUSE: 'Final accusation',
  END_TURN: 'End of turn',
  GAME_OVER: 'Case closed',
};

export function CommandBar({ state, onAccuse }: Props) {
  const me = useMe(state);
  const myTurn = state.turnPlayerId === state.you;
  const current = state.players.find((p) => p.id === state.turnPlayerId);
  const currentMeta = current ? suspectOf(current) : null;
  const meMeta = me ? suspectOf(me) : null;
  const [pickSuspect, setPickSuspect] = useState<string | null>(null);
  const [pickWeapon, setPickWeapon] = useState<string | null>(null);
  const roomId = me?.pos.kind === 'room' ? me.pos.roomId : null;

  const passageTarget = useMemo(() => {
    if (!myTurn || state.phase !== 'ROLL' || !me || me.pos.kind !== 'room') return null;
    return secretPassageTarget(me.pos.roomId) ?? null;
  }, [myTurn, state.phase, me]);

  // Fresh theory form whenever a new suggestion phase opens.
  useEffect(() => {
    if (state.phase === 'SUGGEST') {
      setPickSuspect(null);
      setPickWeapon(null);
    }
  }, [state.phase, state.turn]);

  if (!me) return null;

  const prompt = state.prompt;
  const cardsForPrompt = prompt ? prompt.options : [];

  const submit = (action: Parameters<typeof store.dispatch>[0], sfx?: string) => {
    if (sfx) audio.click();
    store.dispatch(action);
  };

  return (
    <section className="panel dossier">
      <div className="phasebar">
        <div
          className="avatar"
          style={{
            background: `radial-gradient(circle at 34% 28%, ${currentMeta?.glow ?? '#ccc'}, ${currentMeta?.color ?? '#888'})`,
          }}
        >
          {current ? initialsOf(current.name) : '?'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="who">{current ? current.name : '—'}</div>
          <div className="sub">
            {currentMeta?.title ?? ''}
            {current?.isBot ? ' · automaton' : ''}
            {current?.eliminated ? ' · witness only' : ''}
          </div>
        </div>
        <div className={`phase-badge${myTurn && state.phase !== 'GAME_OVER' ? ' hot' : ''}`}>
          {myTurn ? 'Your move · ' : ''}
          {PHASE_TEXT[state.phase] ?? state.phase}
        </div>
      </div>

      <div className="actions">
        {/* ---------------- my turn ---------------- */}
        {myTurn && state.phase === 'ROLL' ? (
          <>
            <button
              className="btn gold block"
              onClick={() => {
                audio.unlock();
                submit({ type: 'ROLL', playerId: state.you });
              }}
            >
              ⚂ Roll the dice (2d6)
            </button>
            {passageTarget ? (
              <button
                className="btn crimson block"
                onClick={() => submit({ type: 'SECRET_PASSAGE', playerId: state.you }, 'passage')}
              >
                ⟡ Take secret passage to {ROOM_BY_ID[passageTarget]?.name}
              </button>
            ) : (
              <div className="callout info">
                You are in the {roomId ? ROOM_BY_ID[roomId]?.name : 'corridor'}. Corner rooms hide passages into the
                diagonally opposite room.
              </div>
            )}
          </>
        ) : null}

        {myTurn && state.phase === 'MOVE' ? (
          <>
            <div className="callout">
              You rolled <b>{state.dice?.[0]}</b> + <b>{state.dice?.[1]}</b> = <b>{state.dice?.[0]! + state.dice?.[1]!}</b>{' '}
              pips. Click a lit space on the board
              {state.legalMoves.some((m) => m.pos.kind === 'room') ? ' or a glowing room' : ''} to walk there.
            </div>
            <div className="btnrow">
              {state.legalMoves
                .filter((m) => m.pos.kind === 'room')
                .slice(0, 4)
                .map((m) => (
                  <button
                    key={m.key}
                    className="btn small"
                    onClick={() =>
                      submit({ type: 'MOVE', playerId: state.you, to: m.pos }, 'move')
                    }
                  >
                    → {ROOM_BY_ID[(m.pos as any).roomId]?.name} ({m.dist})
                  </button>
                ))}
            </div>
          </>
        ) : null}

        {myTurn && state.phase === 'SUGGEST' ? (
          <>
            <div className="callout">
              You are in the <b>{roomId ? ROOM_BY_ID[roomId]?.name : 'room'}</b>. The crime scene is locked to this
              room — name the villain and the weapon.
            </div>
            <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--parchment-dim)' }}>
              Suspect
            </div>
            <div className="tilegrid">
              {SUSPECTS.map((s) => (
                <button
                  key={s.id}
                  className={`tile${pickSuspect === s.id ? ' sel' : ''}`}
                  onClick={() => {
                    setPickSuspect(s.id);
                    audio.click(1200);
                  }}
                >
                  <span
                    className="pip"
                    style={{ background: s.color, display: 'inline-block', marginRight: 7, verticalAlign: 'middle' }}
                  />
                  {s.name}
                  <span className="sub">{s.title}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--parchment-dim)', marginTop: 6 }}>
              Weapon
            </div>
            <div className="tilegrid">
              {WEAPONS.map((w) => (
                <button
                  key={w.id}
                  className={`tile${pickWeapon === w.id ? ' sel' : ''}`}
                  onClick={() => {
                    setPickWeapon(w.id);
                    audio.click(1200);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" style={{ marginRight: 6, verticalAlign: '-2px' }}>
                    <WeaponGlyph id={w.id} color="currentColor" />
                  </svg>
                  {w.name}
                  <span className="sub">found in the {ROOM_BY_ID[state.weaponLocations[w.id]]?.name}</span>
                </button>
              ))}
            </div>
            <button
              className="btn gold block"
              disabled={!pickSuspect || !pickWeapon}
              onClick={() =>
                submit(
                  { type: 'SUGGEST', playerId: state.you, suspectId: pickSuspect!, weaponId: pickWeapon! },
                  'suggest',
                )
              }
            >
              “I suggest the murder was done by{' '}
              {pickSuspect ? SUSPECT_BY_ID[pickSuspect]?.name : '…'} with the{' '}
              {pickWeapon ? WEAPON_BY_ID[pickWeapon]?.name : '…'} in the{' '}
              {roomId ? ROOM_BY_ID[roomId]?.name : '…'}”
            </button>
            <button className="btn ghost block" onClick={() => submit({ type: 'SKIP_SUGGEST', playerId: state.you })}>
              Keep my theory to myself
            </button>
          </>
        ) : null}

        {myTurn && state.phase === 'DISPROVE' && prompt ? (
          <>
            <div className="callout danger">
              <b>{state.players.find((p) => p.id === prompt.suggesterId)?.name}</b> suggests{' '}
              <b>{SUSPECT_BY_ID[prompt.suspectId]?.name}</b> with the <b>{WEAPON_BY_ID[prompt.weaponId]?.name}</b> in
              the <b>{ROOM_BY_ID[prompt.roomId]?.name}</b>. You hold {cardsForPrompt.length} of those cards — slide{' '}
              <b>one</b> across the table. Nobody else will see which.
            </div>
            <div className="hand">
              {cardsForPrompt.map((cardId) => {
                const card = CARD_BY_ID[cardId];
                return (
                  <button
                    key={cardId}
                    className="card"
                    style={{ cursor: 'pointer' }}
                    onClick={() =>
                      submit(
                        { type: 'DISPROVE', playerId: state.you, promptId: prompt.id, cardId },
                        'reveal',
                      )
                    }
                  >
                    <span className="kind">{card?.kind}</span>
                    <span className="name">{card?.name}</span>
                    <span className="glyph">{card?.kind === 'weapon' ? '𖤐' : card?.kind === 'room' ? '⌂' : '☠'}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {myTurn && state.phase === 'ACCUSE' ? (
          <>
            {state.accusationReady ? (
              <div className="callout danger">
                Nobody could refute your theory and none of the three cards sit in your hand — they are <b>all</b> in the
                confidential envelope. Accuse with certainty.
              </div>
            ) : (
              <div className="callout">
                You may accuse once. Be right and the case is yours; be wrong and you will never roll again.
              </div>
            )}
            <button className="btn crimson block" onClick={onAccuse}>
              ⚖ Open the accusation vault
            </button>
            <button className="btn ghost block" onClick={() => submit({ type: 'SKIP_ACCUSE', playerId: state.you })}>
              No accusation this turn
            </button>
          </>
        ) : null}

        {myTurn && state.phase === 'END_TURN' ? (
          <button className="btn gold block" onClick={() => submit({ type: 'END_TURN', playerId: state.you })}>
            End my turn
          </button>
        ) : null}

        {/* ---------------- waiting / watching ---------------- */}
        {!myTurn && state.phase !== 'GAME_OVER' ? (
          <div className="callout info">
            {current?.isBot ? (
              <>
                <b>{current.name}</b> is turning the case over in their mind…
              </>
            ) : (
              <>
                Waiting on <b>{current?.name}</b> to{' '}
                {state.phase === 'ROLL'
                  ? 'roll the dice'
                  : state.phase === 'MOVE'
                    ? 'choose a route'
                    : state.phase === 'SUGGEST'
                      ? 'make a suggestion'
                      : state.phase === 'DISPROVE'
                        ? 'answer the query'
                        : 'decide on an accusation'}
                .
              </>
            )}
          </div>
        ) : null}

        {myTurn && state.phase === 'DISPROVE' && !prompt ? (
          <div className="callout info">
            Another detective is being asked to disprove a theory. Only they and the suggester will learn the card.
          </div>
        ) : null}

        {me.eliminated ? (
          <div className="callout danger">
            You are a <b>witness</b>: your turns are over, but your cards stay in play and you must still answer any
            query made against them.
          </div>
        ) : null}
      </div>

      {/* my hand */}
      <div className="panel-title" style={{ marginTop: 6 }}>
        Your Confidential Hand
        <span className="rule" />
        {state.hand.length} cards
      </div>
      <div className="hand scroll" style={{ maxHeight: 168 }}>
        {state.hand.map((cardId) => {
          const card = CARD_BY_ID[cardId];
          const shown = state.reveals.some((r) => r.byId === state.you && r.cardId === cardId);
          return (
            <div className="card mini" key={cardId} title={card ? `${card.kind}: ${card.name}` : cardId}>
              <span className="kind">{card?.kind}</span>
              <span className="name">{card?.name}</span>
              <span style={{ fontSize: 9, letterSpacing: '0.14em', color: shown ? 'rgba(122,28,28,0.9)' : 'rgba(60,44,18,0.6)' }}>
                {shown ? 'shown' : ''}
              </span>
            </div>
          );
        })}
        {!state.hand.length ? <span className="muted">No cards yet — the hand is dealt when the game begins.</span> : null}
      </div>

      {/* what everyone else knows */}
      <div className="turnstrip">
        {state.players.map((p) => {
          const meta = SUSPECT_BY_ID[p.suspectId];
          return (
            <span
              key={p.id}
              className={`tchip${p.id === state.turnPlayerId ? ' active' : ''}${p.eliminated ? ' elim' : ''}`}
              title={`${p.name} — ${p.cardCount} cards`}
            >
              <span className="pip" style={{ background: meta?.color }} />
              {p.id === state.you ? 'You' : p.name}
              {p.isBot ? ' ⚙' : ''}
              {p.eliminated ? ' ✝' : !p.connected ? ' ⌛' : ''}
            </span>
          );
        })}
      </div>
      <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--parchment-dim)' }}>
        {(() => {
          const seen = new Set(state.reveals.map((r) => itemIdOf(r.cardId)));
          return `You have accounted for ${state.hand.length + seen.size} of 18 dealt cards. The envelope hides three more.`;
        })()}
      </div>
    </section>
  );
}
