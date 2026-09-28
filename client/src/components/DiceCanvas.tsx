/**
 * Real 3D dice.
 *
 * A tiny rigid-body simulation (gravity, restitution, friction, angular
 * integration via quaternions) runs on a top-layer canvas and is rendered with
 * hand-rolled 3D maths: an orthographic camera, painter-sorted cube faces and
 * affine pip mapping. When the dice have tumbled, they ease into exactly the
 * orientation that shows the value the authoritative engine rolled.
 */
import { useEffect, useRef } from 'react';
import { audio } from '../audio/audio';

/* ------------------------------- maths ------------------------------- */

type V3 = [number, number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

type Quat = [number, number, number, number]; // x, y, z, w

const qMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const qFromAxis = (axis: V3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

const qRotate = (q: Quat, v: V3): V3 => {
  const [x, y, z, w] = q;
  const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
};

const qSlerp = (a: Quat, b: Quat, t: number): Quat => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb: Quat = [...b];
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) {
    return norm4([
      a[0] + t * (bb[0] - a[0]),
      a[1] + t * (bb[1] - a[1]),
      a[2] + t * (bb[2] - a[2]),
      a[3] + t * (bb[3] - a[3]),
    ]);
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
};

const norm4 = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

/** Rotation that brings `from` onto `to`. */
function qBetween(from: V3, to: V3): Quat {
  const f = norm(from);
  const t = norm(to);
  const d = dot(f, t);
  if (d > 0.99999) return [0, 0, 0, 1];
  if (d < -0.99999) {
    const axis = cross(f, [1, 0, 0]);
    const alt = Math.hypot(...axis) < 0.001 ? cross(f, [0, 1, 0]) : axis;
    return qFromAxis(norm(alt), Math.PI);
  }
  const axis = cross(f, t);
  const angle = Math.acos(Math.max(-1, Math.min(1, d)));
  return qFromAxis(norm(axis), angle);
}

/* ------------------------------- dice geometry ------------------------------- */

interface Face {
  normal: V3;
  value: number;
  c0: V3;
  u: V3;
  v: V3;
}

const F = (normal: V3, value: number, c0: V3, u: V3, v: V3): Face => ({ normal, value, c0, u, v });

const FACES: Face[] = [
  F([0, 0, 1], 1, [-0.5, -0.5, 0.5], [1, 0, 0], [0, 1, 0]),
  F([0, 0, -1], 6, [0.5, -0.5, -0.5], [-1, 0, 0], [0, 1, 0]),
  F([1, 0, 0], 3, [0.5, -0.5, 0.5], [0, 0, -1], [0, 1, 0]),
  F([-1, 0, 0], 4, [-0.5, -0.5, -0.5], [0, 0, 1], [0, 1, 0]),
  F([0, 1, 0], 5, [-0.5, 0.5, 0.5], [1, 0, 0], [0, 0, -1]),
  F([0, -1, 0], 2, [-0.5, -0.5, -0.5], [1, 0, 0], [0, 0, 1]),
];

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.24, 0.24],
    [0.5, 0.5],
    [0.76, 0.76],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.28, 0.2],
    [0.28, 0.5],
    [0.28, 0.8],
    [0.72, 0.2],
    [0.72, 0.5],
    [0.72, 0.8],
  ],
};

interface Die {
  p: V3;
  v: V3;
  q: Quat;
  w: V3;
  size: number;
  value: number;
  home: V3;
  restQ: Quat;
  /** Simulated time so far (ms) — keeps integration independent of frame rate. */
  t: number;
}

function restingQuat(value: number): Quat {
  const face = FACES.find((f) => f.value === value) ?? FACES[0];
  const up: V3 = [0, 0, 1];
  const align = qBetween(face.normal, up);
  const yaw = qFromAxis([0, 0, 1], (Math.random() - 0.5) * 0.9);
  return norm4(qMul(yaw, align));
}

/* ------------------------------- component ------------------------------- */

interface Props {
  /** The authoritative roll. */
  dice: [number, number] | null;
  /** Changes on every new roll — the animation trigger. */
  rollKey: number | null;
  total: number;
  compact?: boolean;
}

export function DiceCanvas({ dice, rollKey, total, compact }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<number>(0);
  const stateRef = useRef<Die[]>([]);
  const keyRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const [a, b] = dice ?? [1, 1];
    const now = performance.now();
    const make = (value: number, home: V3, dirSeed: number): Die => {
      const dir = dirSeed > 0 ? 1 : -1;
      return {
        p: [home[0], home[1], 1.6],
        v: [dir * (1.1 + Math.random() * 1.5), -2.2 - Math.random() * 1.4, 0.6 + Math.random() * 0.8],
        q: norm4([
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ] as Quat),
        w: [(Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 22],
        size: 0.44,
        value,
        home,
        restQ: restingQuat(value),
        t: 0,
      };
    };
    stateRef.current = [make(a, [-0.62, 0.1, 0.5], 1), make(b, [0.62, 0.1, 0.5], -1)];
    startRef.current = now;
    if (keyRef.current !== rollKey) {
      keyRef.current = rollKey;
      audio.diceRoll(1000);
    }
    const loop = () => {
      const elapsed = performance.now() - startRef.current;
      draw(canvasRef.current, stateRef.current, elapsed);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey, dice?.[0], dice?.[1]]);

  return (
    <div className="diceoverlay" aria-hidden={!dice}>
      <canvas
        ref={canvasRef}
        className="dicecanvas"
        width={520}
        height={520}
        style={compact ? { width: 'min(34%, 300px)' } : undefined}
      />
      {dice ? (
        <div className="dicetotal" key={rollKey ?? 0} style={{ opacity: 0.92 }}>
          {total}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- renderer ------------------------------- */

function draw(canvas: HTMLCanvasElement | null, dice: Die[], elapsed: number): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // camera: three-quarter view looking down at the baize
  const eye: V3 = [0, -3.15, 3.2];
  const target: V3 = [0, 0.1, 0];
  const f = norm(sub(target, eye));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  const S = W * 0.26;

  const project = (p: V3) => {
    const d = sub(p, eye);
    return {
      x: W / 2 + dot(d, r) * S,
      y: H * 0.56 - dot(d, u) * S,
      depth: dot(d, f),
    };
  };

  /* --- baize / felt tray --- */
  const half = 1.72;
  const corners: V3[] = [
    [-half, -half, 0],
    [half, -half, 0],
    [half, half, 0],
    [-half, half, 0],
  ];
  const pc = corners.map(project);
  ctx.beginPath();
  ctx.moveTo(pc[0].x, pc[0].y);
  for (let i = 1; i < pc.length; i++) ctx.lineTo(pc[i].x, pc[i].y);
  ctx.closePath();
  const felt = ctx.createLinearGradient(0, H * 0.12, 0, H * 0.95);
  felt.addColorStop(0, 'rgba(38,32,22,0.94)');
  felt.addColorStop(1, 'rgba(16,13,9,0.96)');
  ctx.fillStyle = felt;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(212,175,55,0.42)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pc[0].x, pc[0].y);
  for (let i = 1; i < pc.length; i++) ctx.lineTo(pc[i].x, pc[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(212,175,55,0.16)';
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 7]);
  ctx.stroke();
  ctx.setLineDash([]);

  /* --- physics --- */
  const dt = 1 / 120;
  const settleAt = 940;
  for (const die of dice) {
    if (elapsed < settleAt) {
      const horizon = Math.min(elapsed, settleAt);
      const steps = Math.max(1, Math.min(24, Math.round((horizon - die.t) / (dt * 1000))));
      for (let i = 0; i < steps; i++) {
        die.v[2] -= 17 * dt;
        die.p = add(die.p, mul(die.v, dt));
        const hs = die.size / 2;
        if (die.p[2] < hs) {
          die.p[2] = hs;
          if (Math.abs(die.v[2]) > 0.35) {
            die.v[2] = -die.v[2] * 0.42;
            die.v[0] *= 0.9;
            die.v[1] *= 0.9;
            die.w = mul(die.w, 0.72);
            die.w = add(die.w, [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5]);
          } else {
            die.v[2] = 0;
            die.v[0] *= 0.82;
            die.v[1] *= 0.82;
            die.w = mul(die.w, 0.9);
          }
        }
        if (die.p[0] > half - hs) {
          die.p[0] = half - hs;
          die.v[0] = -Math.abs(die.v[0]) * 0.5;
          die.w = mul(die.w, 0.8);
        }
        if (die.p[0] < -half + hs) {
          die.p[0] = -half + hs;
          die.v[0] = Math.abs(die.v[0]) * 0.5;
          die.w = mul(die.w, 0.8);
        }
        if (die.p[1] > half - hs) {
          die.p[1] = half - hs;
          die.v[1] = -Math.abs(die.v[1]) * 0.5;
          die.w = mul(die.w, 0.8);
        }
        if (die.p[1] < -half + hs) {
          die.p[1] = -half + hs;
          die.v[1] = Math.abs(die.v[1]) * 0.5;
          die.w = mul(die.w, 0.8);
        }
        const spin = Math.hypot(die.w[0], die.w[1], die.w[2]);
        if (spin > 0.001) {
          const axis = norm(die.w);
          die.q = norm4(qMul(qFromAxis(axis, spin * dt), die.q));
        }
      }
      die.t = horizon;
    } else {
      // Settle: ease into the exact orientation that shows the rolled value.
      const t = Math.min(1, (elapsed - settleAt) / 260);
      const eased = 1 - Math.pow(1 - t, 3);
      die.q = qSlerp(die.q, die.restQ, eased * 0.34);
      die.p = [
        die.p[0] + (die.home[0] - die.p[0]) * eased * 0.2,
        die.p[1] + (die.home[1] - die.p[1]) * eased * 0.2,
        die.p[2] + (die.size / 2 - die.p[2]) * eased * 0.5,
      ];
    }
  }

  /* --- shadow --- */
  for (const die of dice) {
    const g = project([die.p[0], die.p[1], 0.001]);
    const rad = S * 0.62;
    const grad = ctx.createRadialGradient(g.x, g.y, rad * 0.1, g.x, g.y, rad);
    grad.addColorStop(0, `rgba(0,0,0,${Math.max(0.05, 0.42 - (die.p[2] - die.size / 2) * 0.12)})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, rad, rad * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* --- dice --- */
  interface Poly {
    depth: number;
    path: { x: number; y: number }[];
    bright: number;
    value: number;
    origin: { x: number; y: number };
    ux: { x: number; y: number };
    vy: { x: number; y: number };
    scale: number;
  }
  const polys: Poly[] = [];

  const light = norm([-0.42, -0.7, 0.85]);

  for (const die of dice) {
    for (const face of FACES) {
      const worldNormal = qRotate(die.q, face.normal);
      const centre = add(die.p, mul(worldNormal, die.size / 2));
      const toEye = norm(sub(eye, centre));
      if (dot(worldNormal, toEye) <= 0.03) continue; // back face

      const pts: { x: number; y: number }[] = [];
      for (const [a, b] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as [number, number][]) {
        const local: V3 = add(face.c0, add(mul(face.u, (a - 0.5) * die.size), mul(face.v, (b - 0.5) * die.size)));
        const world = add(die.p, qRotate(die.q, local));
        const pr = project(world);
        pts.push({ x: pr.x, y: pr.y });
      }
      const corner3 = (a: number, b: number) => {
        const local: V3 = add(face.c0, add(mul(face.u, (a - 0.5) * die.size), mul(face.v, (b - 0.5) * die.size)));
        return project(add(die.p, qRotate(die.q, local)));
      };
      const p00 = corner3(0, 0);
      const p10 = corner3(1, 0);
      const p01 = corner3(0, 1);
      const p11 = corner3(1, 1);
      const ux = { x: (p10.x - p00.x + (p11.x - p01.x)) / 2, y: (p10.y - p00.y + (p11.y - p01.y)) / 2 };
      const vy = { x: (p01.x - p00.x + (p11.x - p10.x)) / 2, y: (p01.y - p00.y + (p11.y - p10.y)) / 2 };

      polys.push({
        depth: dot(sub(centre, eye), f),
        path: pts,
        bright: Math.max(0.42, Math.min(1.15, 0.62 + dot(worldNormal, light) * 0.55)),
        value: face.value,
        origin: p00,
        ux,
        vy,
        scale: Math.hypot(ux.x, ux.y),
      });
    }
  }

  polys.sort((a, b) => b.depth - a.depth);

  for (const poly of polys) {
    ctx.beginPath();
    ctx.moveTo(poly.path[0].x, poly.path[0].y);
    for (let i = 1; i < poly.path.length; i++) ctx.lineTo(poly.path[i].x, poly.path[i].y);
    ctx.closePath();

    const base = 233 * poly.bright;
    const c1 = `rgb(${Math.round(Math.min(250, base))}, ${Math.round(Math.min(242, base * 0.96))}, ${Math.round(
      Math.min(220, base * 0.83),
    )})`;
    const c2 = `rgb(${Math.round(Math.min(230, base * 0.88))}, ${Math.round(Math.min(222, base * 0.85))}, ${Math.round(
      Math.min(196, base * 0.7),
    )})`;
    const grad = ctx.createLinearGradient(poly.origin.x, poly.origin.y, poly.origin.x + poly.scale, poly.origin.y + poly.scale);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, poly.scale * 0.045);
    ctx.strokeStyle = 'rgba(60,42,20,0.55)';
    ctx.stroke();

    // pips
    const pipR = Math.max(1.1, poly.scale * (poly.value === 1 ? 0.115 : 0.075));
    for (const [a, b] of PIPS[poly.value] ?? []) {
      const x = poly.origin.x + poly.ux.x * a + poly.vy.x * b;
      const y = poly.origin.y + poly.ux.y * a + poly.vy.y * b;
      const shade = 0.55 + poly.bright * 0.4;
      ctx.beginPath();
      ctx.ellipse(x, y, pipR, pipR * 0.94, 0, 0, Math.PI * 2);
      ctx.fillStyle =
        poly.value === 1
          ? `rgba(${Math.round(120 * shade)}, ${Math.round(24 * shade)}, ${Math.round(24 * shade)}, 1)`
          : `rgba(${Math.round(52 * shade)}, ${Math.round(42 * shade)}, ${Math.round(28 * shade)}, 1)`;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x - pipR * 0.22, y - pipR * 0.26, pipR * 0.36, pipR * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fill();
    }
  }

  // gentle "settled" flourish
  if (elapsed > 1180 && elapsed < 1620) {
    const t = (elapsed - 1180) / 440;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.strokeStyle = 'rgba(212,175,55,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.6, 130 + t * 100, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
