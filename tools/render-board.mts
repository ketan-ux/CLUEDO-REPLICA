import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { writeFileSync } from 'node:fs';
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
(globalThis as any).location = { protocol: 'http:', host: 'x' };
const { createLobby, maskState, reduce } = await import('./shared/engine.js');
const { Board } = await import('./client/src/components/Board.js');

let s = createLobby('BORD', 42);
for (let i = 0; i < 6; i++) { const r = reduce(s, { type: 'ADD_BOT', playerId: 'h' }); if (r.ok) s = r.state; }
const started = reduce(s, { type: 'START_GAME', playerId: 'h' }); s = started.ok ? started.state : s;
// A few turns so tokens are spread around the mansion
for (let i = 0; i < 14; i++) {
  const a = s.players[s.turnIndex];
  if (s.phase === 'ROLL') s = (reduce(s, { type: 'ROLL', playerId: a.id }) as any).state ?? s;
  else if (s.phase === 'MOVE') { const m = s.legalMoves[Math.min(s.legalMoves.length - 1, 2)]; s = (reduce(s, { type: 'MOVE', playerId: a.id, to: m.pos }) as any).state ?? s; }
  else if (s.phase === 'SUGGEST') s = (reduce(s, { type: 'SUGGEST', playerId: a.id, suspectId: 'plum', weaponId: 'rope' }) as any).state ?? s;
  else if (s.phase === 'DISPROVE') s = (reduce(s, { type: 'DISPROVE', playerId: s.pendingPrompt!.playerId, promptId: s.pendingPrompt!.id, cardId: s.pendingPrompt!.options[0] }) as any).state ?? s;
  else if (s.phase === 'ACCUSE') s = (reduce(s, { type: 'SKIP_ACCUSE', playerId: a.id }) as any).state ?? s;
  else if (s.phase === 'END_TURN') s = (reduce(s, { type: 'END_TURN', playerId: a.id }) as any).state ?? s;
  else break;
}
const view = maskState(s, s.players[0].id);
const svg = renderToStaticMarkup(createElement(Board as any, { state: view, onMove: () => {} }));
writeFileSync('/tmp/board.svg', svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="750" '));
console.log('tokens:', view.players.map((p) => `${p.name}=${p.pos.kind === 'room' ? p.pos.roomId : `${p.pos.x},${p.pos.y}`}`).join(' | '));
console.log('weapons:', JSON.stringify(view.weaponLocations));
