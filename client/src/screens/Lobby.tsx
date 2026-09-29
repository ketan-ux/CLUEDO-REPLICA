import { SUSPECTS } from '@shared/constants.js';
import type { MaskedState } from '@shared/types.js';
import { store } from '../store/gameStore';
import type { StoreMeta } from '../store/gameStore';
import { initialsOf } from '../hooks/useGame';
import { audio } from '../audio/audio';

interface Props {
  state: MaskedState;
  meta: StoreMeta;
}

export function Lobby({ state, meta }: Props) {
  const me = state.players.find((p) => p.id === state.you);
  const takenBy = (suspectId: string) => state.players.find((p) => p.suspectId === suspectId);
  const canStart = state.players.length >= 2;
  const hostPresent = state.players.some((p) => p.isHost);

  const sit = (suspectId: string) => {
    audio.unlock();
    audio.click(900);
    store.dispatch({
      type: 'CLAIM_SEAT',
      playerId: state.you,
      suspectId,
      name: meta.name || undefined,
    });
  };

  const addBot = () => {
    audio.unlock();
    audio.paperShuffle(4);
    store.dispatch({ type: 'ADD_BOT', playerId: state.you });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      store.setNotice(`Table code ${state.code} copied.`);
    } catch {
      store.setNotice(`Table code: ${state.code}`);
    }
  };

  return (
    <div className="lobby fade-in">
      <section className="panel">
        <div className="panel-title">
          The Company Assembled
          <span className="rule" />
          {state.players.length}/6 seated
        </div>
        <div className="seats">
          {SUSPECTS.map((s) => {
            const occupant = takenBy(s.id);
            const mine = occupant?.id === state.you;
            return (
              <div key={s.id} className={`seat${occupant ? ' filled' : ''}${mine ? ' me' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className="pawn"
                    style={{ background: `radial-gradient(circle at 34% 28%, ${s.glow}, ${s.color})` }}
                  >
                    {occupant ? initialsOf(occupant.name) : s.short[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="who">{occupant ? occupant.name : s.name}</div>
                    <div className="meta">{occupant ? `${s.name} · ${s.title}` : s.title}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {occupant?.isHost ? <span className="tag host">Host</span> : null}
                  {occupant?.isBot ? <span className="tag bot">AI</span> : null}
                  {mine ? <span className="tag">You</span> : null}
                  {occupant && !occupant.connected ? <span className="tag elim">away</span> : null}
                </div>
                <div style={{ marginTop: 'auto', display: 'flex', gap: 6 }}>
                  {!mine ? (
                    <button
                      className="btn tiny"
                      onClick={() => sit(s.id)}
                      disabled={!occupant && state.players.length >= 6}
                      title={occupant ? `Swap seats with ${occupant.name}` : `Play ${s.name}`}
                    >
                      {occupant ? `Swap for ${s.short}` : `Take ${s.short}`}
                    </button>
                  ) : null}
                  {occupant?.isBot && (state.isHost || mine === false) ? (
                    <button
                      className="btn tiny"
                      disabled={!state.isHost}
                      onClick={() =>
                        store.dispatch({ type: 'REMOVE_PLAYER', playerId: state.you, targetId: occupant.id })
                      }
                    >
                      Dismiss
                    </button>
                  ) : null}
                  {mine ? (
                    <button
                      className="btn tiny ghost"
                      onClick={() =>
                        store.dispatch({ type: 'REMOVE_PLAYER', playerId: state.you, targetId: state.you })
                      }
                    >
                      Leave seat
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section className="panel">
          <div className="panel-title">
            The Table
            <span className="rule" />
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--parchment-dim)' }}>
              Room code
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <span style={{ fontFamily: 'var(--typewriter)', fontSize: 32, letterSpacing: '0.32em', color: 'var(--gold-light)' }}>
                {state.code}
              </span>
              <button className="btn small" onClick={copy}>
                Copy
              </button>
            </div>
            <div className="divider" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={addBot} disabled={!state.isHost || state.players.length >= 6}>
                ⚙ Add an AI detective
              </button>
              {me ? (
                <button
                  className="btn small ghost"
                  onClick={() => store.dispatch({ type: 'REMOVE_PLAYER', playerId: state.you, targetId: state.you })}
                >
                  Stand up
                </button>
              ) : (
                <button className="btn small gold" onClick={() => sit(SUSPECTS[0].id)}>
                  Sit down
                </button>
              )}
            </div>
            <div className="divider" />
            <button
              className="btn gold block"
              disabled={!state.isHost || !canStart}
              onClick={() => {
                audio.paperShuffle(6);
                store.dispatch({ type: 'START_GAME', playerId: state.you });
              }}
            >
              ⚜ Seal the envelope &amp; deal
            </button>
            {!state.isHost ? (
              <p className="hint" style={{ marginTop: 10 }}>
                Only the host can deal the cards. {hostPresent ? 'Waiting on them…' : ''}
              </p>
            ) : null}
            {state.isHost && !canStart ? (
              <p className="hint" style={{ marginTop: 10 }}>
                A séance needs at least two detectives — invite a friend with the room code, or add an AI.
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            The Rules of the House
            <span className="rule" />
          </div>
          <div style={{ padding: '12px 16px 18px', fontSize: 15, color: 'var(--parchment-dim)' }}>
            <ul className="rulelist" style={{ marginTop: 0 }}>
              <li>18 cards are dealt evenly; 3 are sealed in the envelope.</li>
              <li>Roll 2d6, then walk a hallway or step into a room.</li>
              <li>Rooms may be shared; hallway tiles may not.</li>
              <li>Suggestions force the table to answer, clockwise.</li>
              <li>Only the suggester ever sees the card they are shown.</li>
              <li>One false accusation and your night is over.</li>
            </ul>
          </div>
        </section>
      </aside>
    </div>
  );
}
