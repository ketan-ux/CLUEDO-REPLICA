import { useEffect, useRef, useState } from 'react';
import type { MaskedState, Position } from '@shared/types.js';
import { store } from '../store/gameStore';
import { Board } from '../components/Board';
import { DiceCanvas } from '../components/DiceCanvas';
import { CommandBar } from '../components/CommandBar';
import { Ledger } from '../components/Ledger';
import { Notebook } from '../components/Notebook';
import { AccusationVault, StoreModals, SuggestionBanner } from '../components/Modals';
import { audio, playCue } from '../audio/audio';
import type { StoreMeta } from '../store/gameStore';

interface Props {
  state: MaskedState;
  meta: StoreMeta;
}

export function GameScreen({ state, meta }: Props) {
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const lastPhase = useRef<string | null>(null);
  const lastTurn = useRef<number>(0);
  const lastLogId = useRef<string | null>(null);

  /* --- audio cues on notable transitions --- */
  useEffect(() => {
    if (lastPhase.current !== state.phase) {
      if (state.phase === 'SUGGEST') playCue('suggest');
      if (state.phase === 'DISPROVE') playCue('reveal');
      if (state.phase === 'ACCUSE' && lastPhase.current === 'DISPROVE') playCue('disprove');
      lastPhase.current = state.phase;
    }
    if (lastTurn.current !== state.turn) {
      if (lastTurn.current !== 0) playCue('turn');
      lastTurn.current = state.turn;
    }
  }, [state.phase, state.turn]);

  useEffect(() => {
    const latest = state.log[state.log.length - 1];
    if (!latest) return;
    if (lastLogId.current === null) {
      lastLogId.current = latest.id;
      return;
    }
    if (lastLogId.current === latest.id) return;
    lastLogId.current = latest.id;
    if (latest.kind === 'move' || latest.kind === 'passage') playCue(latest.kind === 'passage' ? 'passage' : 'move');
    if (latest.kind === 'win') playCue('win');
    if (latest.kind === 'eliminate') playCue('gavel');
  }, [state.log]);

  // Open the vault automatically when a certain accusation is on the table.
  useEffect(() => {
    if (state.accusationReady && state.turnPlayerId === state.you && state.phase === 'ACCUSE') setVaultOpen(true);
  }, [state.accusationReady, state.turnPlayerId, state.phase, state.you]);

  const me = state.players.find((p) => p.id === state.you);
  const myTurn = state.turnPlayerId === state.you;
  const diceVisible = !!state.dice;
  const total = (state.dice?.[0] ?? 0) + (state.dice?.[1] ?? 0);

  const onMove = (pos: Position) => {
    if (!myTurn || state.phase !== 'MOVE') return;
    audio.unlock();
    playCue('move');
    store.dispatch({ type: 'MOVE', playerId: state.you, to: pos });
  };

  return (
    <div className="game fade-in">
      <div className="boardwrap">
        <div className="boardframe">
          <Board state={state} onMove={onMove} />
          {diceVisible ? (
            <DiceCanvas dice={state.dice} rollKey={state.dice ? total * 1000 + state.turn : null} total={total} />
          ) : null}
        </div>
      </div>

      <div className="side scroll">
        {!me ? (
          <div className="callout info" style={{ margin: 10 }}>
            You are watching from the gallery. The table is full — you will be seated if a detective steps away.
          </div>
        ) : null}
        <CommandBar state={state} onAccuse={() => setVaultOpen(true)} />
        <SuggestionBanner state={state} />
        <Ledger state={state} />
        <div className="panel" style={{ padding: 12 }}>
          <div className="btnrow">
            <button className="btn small" onClick={() => setNotebookOpen(true)}>
              📓 Detective notebook
            </button>
            <button
              className="btn small"
              onClick={() => {
                const next = !audio.ambienceEnabled;
                audio.setAmbienceEnabled(next);
                window.dispatchEvent(new Event('cluedo:ambience'));
                store.setNotice(next ? 'Rain on the windows.' : 'The storm has passed.');
              }}
            >
              {audio.ambienceEnabled ? '🌧 Storm on' : '🌧 Storm off'}
            </button>
            <button
              className="btn small"
              onClick={() => {
                audio.sfxEnabled = !audio.sfxEnabled;
                store.setNotice(audio.sfxEnabled ? 'Sound effects on.' : 'Sound effects muted.');
              }}
            >
              {audio.sfxEnabled ? '🔊 Sound on' : '🔇 Sound muted'}
            </button>
            {state.phase === 'GAME_OVER' && state.isHost ? (
              <button
                className="btn small gold"
                onClick={() => store.dispatch({ type: 'REMATCH', playerId: state.you })}
              >
                ⟲ New case
              </button>
            ) : null}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {meta.mode === 'online-client'
              ? `Synced to host · ${meta.connection}`
              : meta.mode === 'online-host'
                ? `Hosting table ${state.code} · ${meta.peers} guest${meta.peers === 1 ? '' : 's'} · ${meta.connection}`
                : 'Private offline table — bring in AI detectives from the lobby for company.'}
          </div>
        </div>
      </div>

      <Notebook state={state} open={notebookOpen} onClose={() => setNotebookOpen(false)} />
      <AccusationVault
        state={state}
        open={vaultOpen}
        prefill={state.accusationReady}
        onClose={() => setVaultOpen(false)}
      />
      <StoreModals state={state} />
    </div>
  );
}
