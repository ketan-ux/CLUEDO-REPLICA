/**
 * The mansion board.
 *
 * Everything is drawn in board-tile coordinates (viewBox "0 0 24 25"): one SVG
 * unit is one tile, so the engine's pathfinding output can be plotted directly.
 * Tokens animate along the very paths the engine computed.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  DOORS_LIST,
  HALL_TILES,
  classify,
  isHall,
  roomAt,
} from '@shared/board.js';
import { ROOMS, ROOM_BY_ID, SECRET_PASSAGES, SUSPECT_BY_ID, VAULT, WEAPONS } from '@shared/constants.js';
import type { AnimEvent, MaskedState, Position, RoomMeta } from '@shared/types.js';
import { store } from '../store/gameStore';
import { initialsOf } from '../hooks/useGame';
import { RoomArt, WeaponGlyph } from './boardArt';

interface Props {
  state: MaskedState;
  onMove: (pos: Position) => void;
}

const WALL = '#0b0d12';
const HALL_BASE = '#2b2419';
const ROOM_FILL: Record<string, [string, string]> = {
  conservatory: ['#28402f', '#16281d'],
  ballroom: ['#4a2424', '#2c1414'],
  kitchen: ['#3f3020', '#241a10'],
  billiard: ['#25402f', '#132418'],
  dining: ['#422626', '#251313'],
  library: ['#33263f', '#1b1424'],
  hall: ['#41331f', '#241708'],
  lounge: ['#432424', '#251212'],
  study: ['#3b2c1f', '#20170f'],
};

function roomGradient(id: string): [string, string] {
  return ROOM_FILL[id] ?? ['#2a2a2a', '#151515'];
}

/* ------------------------------------------------------------------ */
/* Token placement                                                     */
/* ------------------------------------------------------------------ */

interface Tok {
  key: string;
  kind: 'pawn' | 'suspect' | 'weapon';
  id: string;
  pos: Position;
  label: string;
  color: string;
  glow: string;
  active?: boolean;
  me?: boolean;
  eliminated?: boolean;
}

function edgeSlots(room: RoomMeta, count: number, edge: 'top' | 'bottom') {
  const w = room.x1 - room.x0 + 1;
  const perRow = Math.max(1, Math.min(count, Math.max(1, Math.floor(w - 0.8))));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const span = (w - 1.05) / perRow;
    const x = room.x0 + 0.55 + (col + 0.5) * span;
    // Detectives line the top of the room under the title plate; weapons sit on
    // a rack just above the floor caption, so nothing ever overlaps anything.
    const y = edge === 'top' ? room.y0 + 0.98 + row * 0.6 : Math.max(room.y0 + 1.6, room.y1 - 0.95 - row * 0.6);
    out.push({ x, y });
  }
  return out;
}

function staticPoint(pos: Position, room: RoomMeta | undefined, slot: { x: number; y: number } | null) {
  if (pos.kind === 'hall') return { x: pos.x + 0.5, y: pos.y + 0.5 };
  if (slot) return slot;
  if (room) return { x: (room.x0 + room.x1) / 2 + 0.5, y: (room.y0 + room.y1) / 2 + 0.5 };
  return { x: 12, y: 12.5 };
}

/* ------------------------------------------------------------------ */

export function Board({ state, onMove }: Props) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const anims = useRef(new Map<string, { path: Position[]; start: number; dur: number }>());
  const played = useRef(new Set<number>());
  const hover = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  /* ------- animation clock ------- */
  useEffect(() => {
    const incoming: AnimEvent[] = state.animations ?? [];
    let added = false;
    for (const a of incoming) {
      if (played.current.has(a.seq)) continue;
      played.current.add(a.seq);
      if (a.path.length > 1) {
        const dur = Math.max(340, (a.path.length - 1) * 185);
        anims.current.set(`${a.type}:${a.id}`, { path: a.path, start: performance.now(), dur });
        added = true;
      }
    }
    if (!added) return;
    if (rafRef.current != null) return;
    const loop = () => {
      const now = performance.now();
      let live = false;
      for (const [k, a] of anims.current) {
        if (now - a.start >= a.dur) anims.current.delete(k);
        else live = true;
      }
      tick();
      if (live) rafRef.current = requestAnimationFrame(loop);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state.animations]);

  const roomsById = ROOM_BY_ID;

  /* ------- token list + inside-room seating plan ------- */
  const { tokens, slots } = useMemo(() => {
    const byRoom = new Map<string, Tok[]>();
    const list: Tok[] = [];

    for (const p of state.players) {
      const meta = SUSPECT_BY_ID[p.suspectId];
      const tok: Tok = {
        key: `pawn:${p.id}`,
        kind: 'pawn',
        id: p.id,
        pos: p.pos,
        label: initialsOf(p.name),
        color: meta?.color ?? '#999',
        glow: meta?.glow ?? '#fff',
        active: state.turnPlayerId === p.id,
        me: p.id === state.you,
        eliminated: p.eliminated,
      };
      list.push(tok);
      if (p.pos.kind === 'room') {
        const arr = byRoom.get(p.pos.roomId) ?? [];
        arr.push(tok);
        byRoom.set(p.pos.roomId, arr);
      }
    }

    for (const [suspectId, roomId] of Object.entries(state.suspectRooms ?? {})) {
      if (!roomId) continue;
      const meta = SUSPECT_BY_ID[suspectId];
      // When a detective plays this suspect they are represented by that very
      // pawn, which the engine has already summoned into the room.
      const seated = state.players.some((p) => p.suspectId === suspectId);
      if (seated) continue;
      const tok: Tok = {
        key: `suspect:${suspectId}`,
        kind: 'suspect',
        id: suspectId,
        pos: { kind: 'room', roomId },
        label: (meta?.short ?? suspectId)[0],
        color: meta?.color ?? '#999',
        glow: meta?.glow ?? '#fff',
      };
      list.push(tok);
      const arr = byRoom.get(roomId) ?? [];
      arr.push(tok);
      byRoom.set(roomId, arr);
    }

    for (const w of WEAPONS) {
      const roomId = state.weaponLocations?.[w.id];
      if (!roomId) continue;
      const tok: Tok = {
        key: `weapon:${w.id}`,
        kind: 'weapon',
        id: w.id,
        pos: { kind: 'room', roomId },
        label: w.short,
        color: '#e6ddc4',
        glow: '#d4af37',
      };
      list.push(tok);
      const arr = byRoom.get(roomId) ?? [];
      arr.push(tok);
      byRoom.set(roomId, arr);
    }

    // Slots: detectives along the top of a room, weapons along the bottom sill.
    const slotOf = new Map<string, { x: number; y: number }>();
    for (const [roomId, toks] of byRoom) {
      const room = roomsById[roomId];
      if (!room) continue;
      const people = toks.filter((t) => t.kind !== 'weapon');
      const arms = toks.filter((t) => t.kind === 'weapon');
      const peopleSlots = edgeSlots(room, people.length, 'top');
      const armSlots = edgeSlots(room, arms.length, 'bottom');
      people.forEach((t, i) => slotOf.set(t.key, peopleSlots[i]));
      arms.forEach((t, i) => slotOf.set(t.key, armSlots[i]));
    }

    return { tokens: list, slots: slotOf };
  }, [state.players, state.suspectRooms, state.weaponLocations, state.turnPlayerId, state.you, roomsById]);

  const slotFor = (t: Tok): { x: number; y: number } | null => slots.get(t.key) ?? null;

  const roomOf = (pos: Position) => (pos.kind === 'room' ? roomsById[pos.roomId] : undefined);
  const anchor = (pos: Position, t: Tok) => staticPoint(pos, roomOf(pos), slotFor(t));

  const pointFor = (t: Tok) => {
    const anim = anims.current.get(`${t.kind}:${t.id}`);
    if (anim && anim.path.length > 1) {
      const p = Math.min(1, (performance.now() - anim.start) / anim.dur);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const segments = anim.path.length - 1;
      const seg = Math.max(0, Math.min(segments - 1, Math.floor(eased * segments)));
      const local = eased * segments - seg;
      const a = anchor(anim.path[seg], t);
      const b = anchor(anim.path[seg + 1], t);
      return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
    }
    return anchor(t.pos, t);
  };

  /* ------- legal destinations ------- */
  const reach = state.legalMoves ?? [];
  const reachHall = new Map<string, { dist: number; pos: Position }>();
  const reachRooms = new Map<string, { dist: number; pos: Position }>();
  for (const m of reach) {
    if (m.pos.kind === 'hall') reachHall.set(`${m.pos.x},${m.pos.y}`, { dist: m.dist, pos: m.pos });
    else reachRooms.set(m.pos.roomId, { dist: m.dist, pos: m.pos });
  }
  const myTurn = state.turnPlayerId === state.you;
  const canMove = myTurn && state.phase === 'MOVE' && reach.length > 0;

  return (
    <svg
      className="board"
      viewBox="0 0 24 25"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Mansion floor plan"
      onMouseLeave={() => {
        hover.current = null;
        tick();
      }}
    >
      <defs>
        <linearGradient id="hallgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#332a1d" />
          <stop offset="100%" stopColor="#241d13" />
        </linearGradient>
        <pattern id="parquet" width="1" height="1" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="url(#hallgrad)" />
          <path d="M0 0 H1 M0 0 V1" stroke="rgba(212,175,55,0.13)" strokeWidth="0.035" />
          <path d="M0.5 0 V0.5 M0 0.5 H1" stroke="rgba(212,175,55,0.07)" strokeWidth="0.03" />
        </pattern>
        <pattern id="vaultfloor" width="1" height="1" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#15110f" />
          <path d="M0 0 H1 M0 0 V1" stroke="rgba(212,175,55,0.16)" strokeWidth="0.03" />
        </pattern>
        <radialGradient id="vaultglow">
          <stop offset="0%" stopColor="rgba(122,28,28,0.5)" />
          <stop offset="100%" stopColor="rgba(122,28,28,0)" />
        </radialGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.18" />
        </filter>
        <filter id="roomglow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.22" floodColor="#f0d67a" floodOpacity="0.85" />
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="rgba(165,38,38,0.9)" />
        </marker>
      </defs>

      {/* stone shell */}
      <rect x="0" y="0" width="24" height="25" fill={WALL} />

      {/* hallways */}
      {HALL_TILES.map((t) => (
        <g key={`h${t.x}-${t.y}`}>
          <rect x={t.x} y={t.y} width="1" height="1" fill="url(#parquet)" stroke="rgba(0,0,0,0.35)" strokeWidth="0.02" />
        </g>
      ))}

      {/* rooms */}
      {ROOMS.map((room) => {
        const [c1, c2] = roomGradient(room.id);
        const w = room.x1 - room.x0 + 1;
        const h = room.y1 - room.y0 + 1;
        const highlight = reachRooms.has(room.id) && canMove;
        return (
          <g key={room.id} className={`roomshape${highlight ? ' reachable' : ''}`}>
            <rect
              x={room.x0 - 0.04}
              y={room.y0 - 0.04}
              width={w + 0.08}
              height={h + 0.08}
              fill={c2}
              stroke="rgba(212,175,55,0.5)"
              strokeWidth="0.045"
            />
            <rect x={room.x0} y={room.y0} width={w} height={h} fill={c1} opacity="0.92" />
            <RoomArt room={room} />
            {/* title plate */}
            <rect x={room.x0} y={room.y0} width={w} height={0.66} fill="rgba(8,7,5,0.62)" />
            <path
              d={`M${room.x0} ${room.y0 + 0.66} H${room.x1 + 1}`}
              stroke="rgba(212,175,55,0.45)"
              strokeWidth="0.03"
            />
            <text
              x={room.x0 + w / 2}
              y={room.y0 + 0.46}
              textAnchor="middle"
              fontSize="0.4"
              fill="rgba(245,235,215,0.9)"
              style={{ fontFamily: 'var(--display)', letterSpacing: '0.1em' }}
              pointerEvents="none"
            >
              {room.name.toUpperCase()}
            </text>
            {SECRET_PASSAGES[room.id] ? (
              <text
                x={room.x0 + w / 2}
                y={room.y1 - 0.12}
                textAnchor="middle"
                fontSize="0.24"
                fill="rgba(212,175,55,0.75)"
                style={{ fontFamily: 'var(--body)', letterSpacing: '0.08em' }}
                pointerEvents="none"
              >
                → passage to {ROOM_BY_ID[SECRET_PASSAGES[room.id]]?.name}
              </text>
            ) : null}
            {highlight ? (
              <rect
                x={room.x0}
                y={room.y0}
                width={w}
                height={h}
                fill="rgba(240,214,122,0.16)"
                stroke="rgba(240,214,122,0.95)"
                strokeWidth="0.06"
                style={{ cursor: 'pointer' }}
                onClick={() => onMove({ kind: 'room', roomId: room.id })}
              >
                <title>Move into the {room.name}</title>
              </rect>
            ) : null}
          </g>
        );
      })}

      {/* sealed cellar vault in the dead centre */}
      <g>
        <rect x={VAULT.x0 - 0.1} y={VAULT.y0 - 0.1} width={VAULT.x1 - VAULT.x0 + 1.2} height={VAULT.y1 - VAULT.y0 + 1.2} fill="url(#vaultglow)" />
        <rect x={VAULT.x0} y={VAULT.y0} width={VAULT.x1 - VAULT.x0 + 1} height={VAULT.y1 - VAULT.y0 + 1} fill="url(#vaultfloor)" stroke="rgba(212,175,55,0.55)" strokeWidth="0.06" />
        <rect x={VAULT.x0 + 0.14} y={VAULT.y0 + 0.14} width={VAULT.x1 - VAULT.x0 + 0.72} height={VAULT.y1 - VAULT.y0 + 0.72} fill="none" stroke="rgba(212,175,55,0.22)" strokeWidth="0.03" />
        {/* riveted iron door */}
        <circle cx={11.5} cy={11.5} r="2.05" fill="#1a1410" stroke="rgba(212,175,55,0.6)" strokeWidth="0.06" />
        <circle cx={11.5} cy={11.5} r="1.55" fill="none" stroke="rgba(212,175,55,0.3)" strokeWidth="0.035" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <circle key={i} cx={11.5 + Math.cos(a) * 1.8} cy={11.5 + Math.sin(a) * 1.8} r="0.075" fill="rgba(212,175,55,0.75)" />
          );
        })}
        <path d="M11.5 9.6 V13.4 M9.6 11.5 H13.4" stroke="rgba(212,175,55,0.5)" strokeWidth="0.07" />
        <circle cx={11.5} cy={11.5} r="0.4" fill="none" stroke="rgba(212,175,55,0.85)" strokeWidth="0.07" />
        {/* wax seal */}
        <circle cx={11.5} cy={13.6} r="0.42" fill="#7a1c1c" stroke="rgba(255,180,180,0.4)" strokeWidth="0.05" />
        <text x={11.5} y={13.95} textAnchor="middle" fontSize="0.62" fill="rgba(255,224,224,0.92)" style={{ fontFamily: 'var(--display)', fontWeight: 700 }}>
          C
        </text>
        <text x={11.5} y={8.86} textAnchor="middle" fontSize="0.4" fill="rgba(230,221,196,0.82)" style={{ fontFamily: 'var(--display)', letterSpacing: '0.15em' }}>
          THE CELLAR
        </text>
        <text x={11.5} y={9.34} textAnchor="middle" fontSize="0.22" fill="rgba(212,175,55,0.72)" style={{ fontFamily: 'var(--body)', letterSpacing: '0.12em' }}>
          MURDER ENVELOPE SEALED
        </text>
        <text x={11.5} y={14.62} textAnchor="middle" fontSize="0.24" fill="rgba(212,175,55,0.6)" style={{ fontFamily: 'var(--body)', letterSpacing: '0.16em' }}>
          NO ENTRY
        </text>
      </g>

      {/* secret passages — drawn along the outer galleries so no line ever crosses a room */}
      {[
        // Kitchen (top-right) ⟷ Study (bottom-left): down the east gallery, along the south
        { key: 'k-s', d: 'M22.5 6.6 L23.5 7.6 L23.5 24.5 L4.6 24.5' },
        // Lounge (bottom-right) ⟷ Conservatory (top-left): down the west gallery then north
        { key: 'l-c', d: 'M15.4 19.5 L14.5 19.5 L0.5 19.5 L0.5 1.5 L3.5 0.5' },
      ].map(({ key, d }) => (
        <path
          key={key}
          d={d}
          fill="none"
          stroke="rgba(165,38,38,0.42)"
          strokeWidth="0.045"
          strokeDasharray="0.22 0.2"
          markerEnd="url(#arrow)"
          pointerEvents="none"
        />
      ))}

      {/* doorways */}
      {DOORS_LIST.map((d) => {
        const { x, y } = d.tile;
        const horizontal = d.dir === 'n' || d.dir === 's';
        const bx = d.dir === 'w' ? x : d.dir === 'e' ? x + 1 : x;
        const by = d.dir === 'n' ? y : d.dir === 's' ? y + 1 : y;
        return (
          <g key={d.id}>
            {horizontal ? (
              <>
                {/* opening: a dark threshold cut through the wall */}
                <rect x={x + 0.26} y={by - 0.09} width="0.48" height="0.18" fill="#05060a" />
                <path d={`M${x + 0.26} ${by} H${x + 0.74}`} stroke="rgba(240,214,122,0.9)" strokeWidth="0.05" />
                {/* jambs */}
                <path d={`M${x + 0.26} ${by - 0.14} V${by + 0.14} M${x + 0.74} ${by - 0.14} V${by + 0.14}`} stroke="rgba(212,175,55,0.9)" strokeWidth="0.045" />
                {/* the door itself, standing open into the room */}
                <path
                  d={`M${x + 0.29} ${by + (d.dir === 'n' ? 0.6 : -0.6)} L${x + 0.29} ${by}`}
                  stroke="rgba(245,235,215,0.62)"
                  strokeWidth="0.055"
                />
              </>
            ) : (
              <>
                <rect x={bx - 0.09} y={y + 0.26} width="0.18" height="0.48" fill="#05060a" />
                <path d={`M${bx} ${y + 0.26} V${y + 0.74}`} stroke="rgba(240,214,122,0.9)" strokeWidth="0.05" />
                <path d={`M${bx - 0.14} ${y + 0.26} H${bx + 0.14} M${bx - 0.14} ${y + 0.74} H${bx + 0.14}`} stroke="rgba(212,175,55,0.9)" strokeWidth="0.045" />
                <path
                  d={`M${bx + (d.dir === 'w' ? 0.6 : -0.6)} ${y + 0.29} L${bx} ${y + 0.29}`}
                  stroke="rgba(245,235,215,0.62)"
                  strokeWidth="0.055"
                />
              </>
            )}
          </g>
        );
      })}

      {/* reachable hallway tiles */}
      {canMove &&
        [...reachHall.entries()].map(([key, m]) => {
          const [x, y] = key.split(',').map(Number);
          const isHover = hover.current === key;
          return (
            <g key={`r${key}`}>
              <rect
                x={x + 0.06}
                y={y + 0.06}
                width="0.88"
                height="0.88"
                fill={isHover ? 'rgba(240,214,122,0.42)' : 'rgba(240,214,122,0.2)'}
                stroke="rgba(240,214,122,0.75)"
                strokeWidth="0.04"
                strokeDasharray="0.16 0.12"
                style={{ cursor: 'pointer' }}
                onClick={() => onMove(m.pos)}
                onMouseEnter={() => {
                  hover.current = key;
                  tick();
                }}
              >
                <title>Move {m.dist} pips</title>
              </rect>
              <text x={x + 0.5} y={y + 0.66} textAnchor="middle" fontSize="0.3" fill="rgba(255,246,220,0.8)" pointerEvents="none">
                {m.dist}
              </text>
            </g>
          );
        })}

      {/* tokens */}
      {tokens.map((t) => {
        const p = pointFor(t);
        if (t.kind === 'weapon') {
          return (
            <g key={t.key} transform={`translate(${p.x - 0.34} ${p.y - 0.34})`} style={{ pointerEvents: 'none' }}>
              <rect width="0.68" height="0.68" rx="0.12" fill="rgba(16,14,10,0.92)" stroke="rgba(212,175,55,0.75)" strokeWidth="0.04" />
              <g transform={`translate(0.05 0.05) scale(${0.58 / 24})`}>
                <WeaponGlyph id={t.id} color="#efdfae" />
              </g>
              <title>{WEAPONS.find((w) => w.id === t.id)?.name}</title>
            </g>
          );
        }
        const r = t.kind === 'suspect' ? 0.32 : 0.36;
        return (
          <g key={t.key} transform={`translate(${p.x} ${p.y})`} style={{ pointerEvents: 'none' }} opacity={t.eliminated ? 0.45 : 1}>
            {t.active ? (
              <circle r={r + 0.14} fill="none" stroke="rgba(240,214,122,0.85)" strokeWidth="0.05">
                <animate attributeName="r" values={`${r + 0.08};${r + 0.22};${r + 0.08}`} dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="1.8s" repeatCount="indefinite" />
              </circle>
            ) : null}
            <circle r={r} fill={t.color} stroke={t.me ? '#f0d67a' : 'rgba(0,0,0,0.65)'} strokeWidth={t.me ? 0.07 : 0.045} />
            <circle r={r * 0.72} fill="rgba(0,0,0,0.14)" />
            <text
              className="tokenlabel"
              y={r * 0.32}
              textAnchor="middle"
              fontSize={r * 1.02}
              fill="#14100a"
              style={{ fontFamily: 'var(--display)' }}
            >
              {t.label}
            </text>
            {t.kind === 'suspect' ? (
              <circle r={r + 0.07} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.03" strokeDasharray="0.1 0.08" />
            ) : null}
            {t.eliminated ? (
              <path d={`M${-r} ${-r} L${r} ${r} M${r} ${-r} L${-r} ${r}`} stroke="rgba(165,38,38,0.85)" strokeWidth="0.06" />
            ) : null}
          </g>
        );
      })}

      {/* compass rose */}
      <g opacity="0.5" transform="translate(0.75 24.2)">
        <path d="M0 -0.5 L0.16 0 L0 0.5 L-0.16 0 z" fill="rgba(212,175,55,0.7)" />
        <text x="0" y="-0.62" textAnchor="middle" fontSize="0.3" fill="rgba(212,175,55,0.85)" style={{ fontFamily: 'var(--display)' }}>
          N
        </text>
      </g>
    </svg>
  );
}
