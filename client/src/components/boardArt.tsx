/**
 * Hand-drawn Art Deco fittings for each room of the mansion, plus the six weapon
 * glyphs. Everything is vector work — no image assets — so the board stays crisp
 * at any size and the palette stays under our control.
 */
import type { RoomMeta } from '@shared/types.js';

interface ArtProps {
  room: RoomMeta;
}

const INK = 'rgba(20,16,10,0.55)';
const GOLD = 'rgba(212,175,55,0.55)';

/** Decorative fittings drawn inside a room, in board tile coordinates. */
export function RoomArt({ room }: ArtProps) {
  const { x0, y0, x1, y1, motif } = room;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const sw = Math.max(0.03, 0.028 * Math.min(w, h));

  switch (motif) {
    case 'glass': // Conservatory — iron-framed glasshouse
      return (
        <g stroke={INK} strokeWidth={sw} fill="none" opacity="0.85">
          <rect x={x0 + 0.5} y={y0 + 0.5} width={w - 1} height={h - 1} rx={0.2} />
          <path d={`M${x0 + w / 2} ${y0 + 0.5} V${y1 - 0.5} M${x0 + 0.5} ${y0 + h / 2} H${x1 - 0.5}`} />
          <circle cx={cx} cy={cy} r={Math.min(w, h) / 4.2} />
          <path d={`M${cx - 0.6} ${cy + 0.3} q0.6 -0.7 1.2 0`} stroke={GOLD} />
          <path d={`M${x0 + 0.9} ${y1 - 0.9} q0.5 -0.6 1 0 q0.5 -0.6 1 0`} stroke={GOLD} strokeWidth={sw * 0.8} />
        </g>
      );
    case 'chandelier': // Ballroom — dance floor + chandelier
      return (
        <g opacity="0.9">
          <g stroke={INK} strokeWidth={sw} fill="none">
            <rect x={x0 + 0.8} y={y0 + 2.6} width={w - 1.6} height={h - 3.4} rx={0.2} />
            <path
              d={`M${x0 + 0.8} ${y0 + 5.6} H${x1 - 0.8} M${x0 + w / 2} ${y0 + 2.6} V${y1 - 0.8}`}
            />
          </g>
          <g stroke={GOLD} strokeWidth={sw * 1.1} fill="none">
            <circle cx={cx} cy={y0 + 1.5} r={0.62} />
            <path
              d={`M${cx - 1.1} ${y0 + 2.2} q1.1 0.8 2.2 0 M${cx} ${y0 + 0.9} V${y0 + 0.35}`}
            />
          </g>
        </g>
      );
    case 'range': // Kitchen — cast-iron range and hanging pans
      return (
        <g stroke={INK} strokeWidth={sw} fill="none" opacity="0.9">
          <rect x={x0 + 0.9} y={y0 + 3.1} width={w - 1.8} height={h - 4.2} rx={0.18} />
          <g stroke={GOLD}>
            {[0, 1, 2].map((i) => (
              <circle key={i} cx={x0 + 1.7 + i * 1.5} cy={y0 + 3.9} r={0.32} />
            ))}
          </g>
          <path d={`M${x0 + 1.6} ${y0 + 5.4} H${x1 - 1.6} M${x0 + 1.6} ${y0 + 5.9} H${x1 - 1.6}`} />
          <g stroke={GOLD} strokeWidth={sw * 0.9}>
            <path d={`M${x1 - 2.4} ${y0 + 1.3} v0.8`} />
            <circle cx={x1 - 2.4} cy={y0 + 2.3} r={0.34} fill="none" />
            <path d={`M${x1 - 1.3} ${y0 + 1.3} v0.6`} />
            <circle cx={x1 - 1.3} cy={y0 + 2.05} r={0.3} fill="none" />
          </g>
        </g>
      );
    case 'baize': // Billiard Room — table, pockets, cue rack
      return (
        <g opacity="0.92">
          <rect x={x0 + 0.8} y={y0 + 2.2} width={w - 1.6} height={h - 4.4} rx={0.28} fill="rgba(28,74,52,0.55)" stroke={GOLD} strokeWidth={sw} />
          <g fill="rgba(10,12,10,0.75)">
            {[
              [x0 + 0.95, y0 + 2.35],
              [x1 - 0.95, y0 + 2.35],
              [x0 + 0.95, y1 - 2.35],
              [x1 - 0.95, y1 - 2.35],
              [cx, y0 + 2.35],
              [cx, y1 - 2.35],
            ].map(([px, py], i) => (
              <circle key={i} cx={px} cy={py} r={0.22} />
            ))}
          </g>
          <g>
            <circle cx={cx - 0.5} cy={cy} r={0.17} fill="#f2ead4" />
            <circle cx={cx + 0.1} cy={cy - 0.24} r={0.17} fill="#b4232a" />
            <circle cx={cx + 0.5} cy={cy + 0.2} r={0.17} fill="#d4af37" />
          </g>
          <g stroke={GOLD} strokeWidth={sw * 0.9}>
            <path d={`M${x1 - 1.1} ${y0 + 1.4} l-0.9 0.5`} />
            <path d={`M${x1 - 1.1} ${y0 + 1.65} l-0.9 0.5`} />
          </g>
        </g>
      );
    case 'banquet': // Dining Room — long table, chairs, candelabra
      return (
        <g opacity="0.92">
          <rect x={x0 + 1.4} y={y0 + 2.4} width={w - 2.8} height={h - 5.2} rx={0.34} fill="rgba(60,40,20,0.5)" stroke={GOLD} strokeWidth={sw} />
          <g stroke={INK} strokeWidth={sw * 1.2}>
            <path d={`M${x0 + 0.7} ${y0 + 3.1} h0.7 M${x0 + 0.7} ${cy} h0.7 M${x0 + 0.7} ${y1 - 1.1} h0.7`} />
            <path d={`M${x1 - 1.4} ${y0 + 3.1} h0.7 M${x1 - 1.4} ${cy} h0.7 M${x1 - 1.4} ${y1 - 1.1} h0.7`} />
          </g>
          <g stroke={GOLD} strokeWidth={sw}>
            <path d={`M${cx - 0.5} ${y0 + 1.6} v0.7 M${cx + 0.5} ${y0 + 1.6} v0.7`} />
            <circle cx={cx - 0.5} cy={y0 + 1.5} r={0.12} fill={GOLD} />
            <circle cx={cx + 0.5} cy={y0 + 1.5} r={0.12} fill={GOLD} />
            <path d={`M${cx - 1.5} ${cy} h3`} />
          </g>
        </g>
      );
    case 'books': // Library — shelves, ladder, globe
      return (
        <g opacity="0.92">
          <g stroke={GOLD} strokeWidth={sw}>
            <path
              d={`M${x0 + 0.7} ${y0 + 1.05} h${w - 1.4} M${x0 + 0.7} ${y0 + 1.7} h${w - 1.4} M${x0 + 0.7} ${y0 + 2.35} h${w - 1.4}`}
            />
          </g>
          <g stroke={INK} strokeWidth={sw * 1.6} opacity="0.75">
            {Array.from({ length: Math.floor(w - 1.6) }, (_, i) => (
              <path key={i} d={`M${x0 + 1 + i} ${y0 + 1.1} v0.55 M${x0 + 1 + i} ${y0 + 1.75} v0.5`} />
            ))}
          </g>
          <g stroke={INK} strokeWidth={sw} fill="none">
            <path d={`M${x0 + 1.2} ${y1 - 0.7} l0.7 -1.6 M${x0 + 2.9} ${y1 - 0.7} l0.7 -1.6`} />
            <circle cx={x1 - 1.6} cy={y1 - 1.4} r={0.5} />
            <path d={`M${x1 - 2.1} ${y1 - 1.4} h1`} />
          </g>
        </g>
      );
    case 'grand': // Hall — staircase and columns
      return (
        <g stroke={INK} strokeWidth={sw} fill="none" opacity="0.9">
          <g>
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} x={x0 + 1 + i * 0.75} y={y1 - 2.2 - i * 0.55} width={w - 2 - i * 1.5} height={0.42} />
            ))}
          </g>
          <g stroke={GOLD}>
            <path d={`M${x0 + 0.8} ${y0 + 0.8} v${h - 1.6} M${x1 - 0.8} ${y0 + 0.8} v${h - 1.6}`} strokeWidth={sw * 1.4} />
            <circle cx={cx} cy={y0 + 2.2} r={0.62} />
            <path d={`M${cx - 0.9} ${y0 + 2.2} h1.8 M${cx} ${y0 + 1.3} v0.28`} />
          </g>
        </g>
      );
    case 'fireside': // Lounge — fireplace and wingback
      return (
        <g opacity="0.92">
          <g stroke={GOLD} strokeWidth={sw} fill="none">
            <path d={`M${x0 + 1.6} ${y1 - 1.2} v-2 q1.5 -1.1 3 0 v2 z`} />
            <path d={`M${cx + 0.2} ${y1 - 1.5} q0.6 -0.7 0 -1.4 q-0.7 -0.8 0.1 -1.5`} stroke="rgba(224,120,40,0.85)" strokeWidth={sw * 1.3} />
          </g>
          <g stroke={INK} strokeWidth={sw} fill="none">
            <path d={`M${x0 + 0.8} ${y0 + 2} h1.7 a0.45 0.45 0 0 1 0 0.9 v0.9 h-1.7 v-0.9 a0.45 0.45 0 0 1 0 -0.9 z`} />
            <path d={`M${x1 - 2.6} ${y0 + 1.9} q0.9 0.6 1.8 0 v1.7 h-1.8 z`} />
            <circle cx={cx} cy={cy + 0.4} r={0.72} />
            <path d={`M${cx - 0.72} ${cy + 0.4} h1.44 M${cx} ${cy - 0.32} v1.44`} />
          </g>
        </g>
      );
    case 'desk': // Study — desk, typewriter, rug
      return (
        <g opacity="0.92">
          <rect x={x0 + 1} y={y0 + 2.1} width={w - 2} height={h - 4.2} rx={0.3} fill="none" stroke={GOLD} strokeWidth={sw} />
          <g stroke={INK} strokeWidth={sw} fill="none">
            <rect x={cx - 1.5} y={cy - 0.2} width={3} height={1.25} rx={0.14} />
            <rect x={cx - 0.55} y={cy - 0.9} width={1.1} height={0.75} rx={0.1} />
            <path d={`M${cx - 1.9} ${cy + 1.05} v0.5 M${cx + 1.9} ${cy + 1.05} v0.5`} />
          </g>
          <g stroke={GOLD} strokeWidth={sw * 0.9}>
            <path d={`M${x0 + 1.4} ${y0 + 1.5} h0.9 v0.7 h-0.9 z`} />
            <path d={`M${x1 - 1.6} ${y1 - 1.1} q0.6 -0.8 1.2 0`} />
          </g>
        </g>
      );
    default:
      return null;
  }
}

/** The six weapons, drawn in a 24x24 glyph box. */
export function WeaponGlyph({ id, color = '#2a2116' }: { id: string; color?: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'candlestick':
      return (
        <g {...common}>
          <path d="M9 20h6M10 20v-9h4v9" />
          <path d="M12 11V8" />
          <path d="M12 4.6c1.4 1.6 1.4 3 0 3.6-1.4-.6-1.4-2 0-3.6z" fill="rgba(224,169,58,0.75)" />
          <path d="M8.4 11h7.2" />
        </g>
      );
    case 'dagger':
      return (
        <g {...common}>
          <path d="M12 2.6l2.4 8.2H9.6z" />
          <path d="M7.6 10.8h8.8" />
          <path d="M12 10.8v7.4" />
          <path d="M10.6 21h2.8" />
        </g>
      );
    case 'leadpipe':
      return (
        <g {...common}>
          <rect x="4.4" y="9.2" width="15.2" height="5.6" rx="2.4" />
          <path d="M8 9.2v5.6M16 9.2v5.6" />
        </g>
      );
    case 'revolver':
      return (
        <g {...common}>
          <circle cx="12" cy="10.4" r="3.6" />
          <path d="M14.6 13.4l2.2 2.6" />
          <path d="M6.6 9.6H3.4" />
          <path d="M9.8 13.6l-1.2 6.2" />
          <circle cx="12" cy="10.4" r="1.1" fill={color} stroke="none" />
        </g>
      );
    case 'rope':
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="6.2" />
          <circle cx="12" cy="12" r="3.9" />
          <path d="M12 5.8l3 4.1-3 4.1-3-4.1z" />
        </g>
      );
    case 'wrench':
      return (
        <g {...common}>
          <path d="M15.4 3.4a4.2 4.2 0 1 0 3.9 6.6l-2.3-1.2.6-2.4 2.5-.1a4.2 4.2 0 0 0-4.7-2.9z" />
          <path d="M15.2 9.6l-8 8.1a1.7 1.7 0 1 0 2.4 2.4l8-8" />
        </g>
      );
    default:
      return null;
  }
}
