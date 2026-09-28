import { useEffect, useMemo, useState } from 'react';
import { useGame } from './hooks/useGame';
import { store } from './store/gameStore';
import { audio } from './audio/audio';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { GameScreen } from './screens/GameScreen';

/* ------------------------------------------------------------------ */
/* Atmosphere: rain, gas-lamp glow, film grain, vignette               */
/* ------------------------------------------------------------------ */

function Rain({ enabled }: { enabled: boolean }) {
  const drops = useMemo(
    () =>
      Array.from({ length: 90 }, () => ({
        x: Math.random() * 100,
        delay: Math.random() * 4,
        dur: 0.7 + Math.random() * 0.9,
        len: 12 + Math.random() * 40,
        op: 0.06 + Math.random() * 0.22,
      })),
    [],
  );
  if (!enabled) return null;
  return (
    <svg className="rainlayer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {drops.map((d, i) => (
        <line
          key={i}
          x1={d.x}
          y1={-10}
          x2={d.x - 1.4}
          y2={-10 + d.len * 0.4}
          stroke={`rgba(214,226,255,${d.op})`}
          strokeWidth="0.16"
        >
          <animate
            attributeName="y1"
            values="-10;110"
            dur={`${d.dur}s`}
            begin={`${d.delay}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values={`${-10 + d.len * 0.4};${110 + d.len * 0.4}`}
            dur={`${d.dur}s`}
            begin={`${d.delay}s`}
            repeatCount="indefinite"
          />
        </line>
      ))}
    </svg>
  );
}

function Atmosphere() {
  const [storm, setStorm] = useState(audio.ambienceEnabled);
  useEffect(() => {
    const onChange = () => setStorm(audio.ambienceEnabled);
    window.addEventListener('cluedo:ambience', onChange);
    return () => window.removeEventListener('cluedo:ambience', onChange);
  }, []);
  return (
    <div className="atmosphere" aria-hidden>
      <Rain enabled={storm} />
      <div className="lampglow a" />
      <div className="lampglow b" />
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function App() {
  const meta = useGame();
  const state = meta.state;

  useEffect(() => {
    void store.boot();
  }, []);

  useEffect(() => {
    const unlock = () => {
      void audio.unlock();
      if (audio.ambienceEnabled && audio.ready && !audio.started) {
        audio.started = true;
        audio.startAmbience();
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const screen = !state || (state.phase === 'LOBBY' && state.players.length === 0) ? 'home' : state.phase === 'LOBBY' ? 'lobby' : 'game';

  return (
    <div className="app">
      <Atmosphere />
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">CLUEDO</span>
          <span className="tagline">Murder at Manderley Hall</span>
        </div>
        <span className="spacer" />
        <span className="conn">
          <span
            className={`dot${
              meta.connection === 'open' || meta.connection === 'local'
                ? ''
                : meta.connection === 'polling' || meta.connection === 'connecting'
                  ? ' warn'
                  : ' bad'
            }`}
          />
          {meta.connection === 'local'
            ? 'solo table'
            : meta.connection === 'open'
              ? meta.mode === 'online-host'
                ? `hosting · ${meta.peers} guest${meta.peers === 1 ? '' : 's'}`
                : 'linked to host'
              : meta.connection === 'polling'
                ? 'long-poll fallback'
                : meta.connection === 'connecting'
                  ? 'connecting…'
                  : 'offline'}
        </span>
        {state ? (
          <div className="roomchip">
            <span className="label">Table</span>
            <span className="code">{state.code}</span>
          </div>
        ) : null}
        {state && state.phase !== 'LOBBY' ? (
          <span style={{ fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--parchment-dim)' }}>
            turn {state.turn}
          </span>
        ) : null}
      </header>

      {screen === 'home' && state ? <Home meta={meta} hasPlayers={state.players.length > 0} /> : null}
      {screen === 'home' && !state ? (
        <div className="home">
          <div className="home-card fade-in" style={{ display: 'block', padding: 40, textAlign: 'center' }}>
            <div className="crest">✦</div>
            <h1>CLUEDO</h1>
            <div className="sub">lighting the gas lamps…</div>
          </div>
        </div>
      ) : null}
      {screen === 'lobby' && state ? <Lobby state={state} meta={meta} /> : null}
      {screen === 'game' && state ? <GameScreen state={state} meta={meta} /> : null}

      {meta.notice ? (
        <div className="toast" onClick={() => store.setNotice(null)} role="status">
          {meta.notice}
        </div>
      ) : null}
    </div>
  );
}

export default App;
