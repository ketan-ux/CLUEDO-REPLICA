import { useState } from 'react';
import { store } from '../store/gameStore';
import { audio } from '../audio/audio';
import { SUSPECTS } from '@shared/constants.js';
import type { StoreMeta } from '../store/gameStore';

interface Props {
  meta: StoreMeta;
  hasPlayers: boolean;
}

export function Home({ meta, hasPlayers }: Props) {
  const [name, setName] = useState(meta.name);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const commitName = () => {
    if (name.trim()) store.setName(name.trim());
  };

  const sit = async () => {
    commitName();
    audio.unlock();
    setBusy(true);
    try {
      store.dispatch({
        type: 'CLAIM_SEAT',
        playerId: meta.youId,
        name: name.trim() || 'Detective',
        suspectId: SUSPECTS[Math.floor(Math.random() * SUSPECTS.length)].id,
      });
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    commitName();
    audio.unlock();
    const target = code.trim().toUpperCase();
    if (target.length < 4) {
      store.setMeta({ error: 'Room codes are four letters, e.g. RAVN.' });
      return;
    }
    setBusy(true);
    const ok = await store.joinRoom(target);
    setBusy(false);
    if (ok) {
      store.dispatch({
        type: 'CLAIM_SEAT',
        playerId: meta.youId,
        name: name.trim() || 'Detective',
      });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meta.code);
      store.setNotice(`Table code ${meta.code} copied — send it to your fellow detectives.`);
    } catch {
      store.setNotice(`Your table code is ${meta.code}.`);
    }
  };

  return (
    <div className="home">
      <div className="home-card fade-in">
        <div className="home-left">
          <div className="crest">✦ ⚜ ✦</div>
          <h1>CLUEDO</h1>
          <div className="sub">A Murder Mystery · Manderley Hall, 1924</div>
          <p className="lede">
            The host was found in the cellar with a wax-sealed envelope on the table. Six suspects, six weapons and nine
            rooms — but only <b>one</b> suspect, <b>one</b> weapon and <b>one</b> room sit inside the envelope. Roll the
            dice, walk the mansion, and put theories to the table until the case cracks open.
          </p>
          <ul className="rulelist">
            <li>Miss Scarlet always moves first; play proceeds clockwise.</li>
            <li>Enter a room and accuse someone <i>in that room</i> — the room card is locked to where you stand.</li>
            <li>Every other detective, clockwise from your left, must show you a matching card if they hold one.</li>
            <li>Corner rooms hide secret passages: Conservatory ⇄ Lounge, Study ⇄ Kitchen.</li>
            <li>One final accusation per turn. Wrong, and you spend the rest of the night as a witness.</li>
          </ul>
        </div>

        <div className="home-right">
          <div className="panel-title" style={{ padding: '0 0 10px', border: 'none' }}>
            Sign the guest book
          </div>
          {meta.error ? <div className="warnbox">{meta.error}</div> : null}
          {!meta.serverAvailable ? (
            <div className="warnbox">
              No relay is answering, so live rooms are unavailable in this browser. You can still play a full table
              against the AI detectives.
            </div>
          ) : null}

          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={22}
              placeholder="Inspector Vance"
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
            />
          </label>

          <button className="btn gold block" disabled={busy} onClick={sit}>
            {hasPlayers ? '→ Return to the table' : '⚜ Sit at my own table'}
          </button>

          <div className="divider" />

          {meta.serverAvailable ? (
            <>
              <label className="field">
                <span>Join with a room code</span>
                <input
                  className="codeinput"
                  type="text"
                  value={code}
                  maxLength={4}
                  placeholder="RAVN"
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void join();
                  }}
                />
              </label>
              <button className="btn block" disabled={busy} onClick={join}>
                Join an existing table
              </button>
              <div className="divider" />
              <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--parchment-dim)' }}>
                Your table code
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <div className="code" style={{ fontFamily: 'var(--typewriter)', fontSize: 30, letterSpacing: '0.3em', color: 'var(--gold-light)' }}>
                  {meta.code}
                </div>
                <button className="btn small" onClick={copy}>
                  Copy
                </button>
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                Anyone on your network — or on the internet, if this table is published — can join with that code. A
                second browser tab works too: open it, enter the code, and you will be seated as a separate detective.
              </p>
            </>
          ) : (
            <p className="hint">
              Offline table: add a few AI detectives from the lobby and the case will play itself out around you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
