/**
 * Procedural noir audio engine — 100% Web Audio synthesis, zero sample files.
 *
 * Rain on the windowpanes, distant thunder, wooden dice on baize, shuffling
 * dossiers, a brass minor-key stinger when a theory is proposed and a courtroom
 * gavel when a final accusation lands.
 */

type Ctx = AudioContext;

const MINOR_TRIADS: number[][] = [
  [220, 261.63, 329.63], // A minor
  [196, 233.08, 293.66], // G minor
  [174.61, 207.65, 261.63], // F minor
  [146.83, 174.61, 220], // D minor
  [164.81, 196, 246.94], // E minor
];

export class NoirAudio {
  ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private reverb: ConvolverNode | null = null;
  private rainNodes: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private thunderTimer: ReturnType<typeof setTimeout> | null = null;
  private raindropTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStinger = 0;
  sfxEnabled = true;
  ambienceEnabled = true;
  /** Set once the rain loop has actually been started. */
  started = false;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from inside a user gesture the first time. */
  async unlock(): Promise<void> {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* the browser will let us try again on the next gesture */
      }
    }
  }

  private build(): void {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    this.master = master;

    const music = ctx.createGain();
    music.gain.value = 0.85;
    const ambience = ctx.createGain();
    ambience.gain.value = 0.55;

    // A short exponential-decay impulse gives every strike a ballroom tail.
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.6, 2.4);
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.24;
    reverb.connect(reverbSend).connect(master);
    this.reverb = reverb;

    music.connect(master);
    music.connect(reverb);
    ambience.connect(master);
    this.musicBus = music;
    this.ambienceBus = ambience;

    this.noiseBuffer = this.noise(3);
  }

  private noise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = white * 0.7 + last * 3.2;
    }
    return buffer;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buffer;
  }

  private env(
    node: AudioNode,
    bus: AudioNode,
    attack: number,
    decay: number,
    peak: number,
    start = 0,
  ): GainNode {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(gain).connect(bus);
    return gain;
  }

  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  /* ---------------------------------------------------------------- */
  /* Rain & thunder ambience                                          */
  /* ---------------------------------------------------------------- */

  startAmbience(): void {
    if (!this.ctx || !this.ambienceBus || this.rainNodes) return;
    const ctx = this.ctx;
    const bus = this.ambienceBus;

    const src = this.noiseSource();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.55;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highpass';
    shelf.frequency.value = 380;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 3.5);

    // Slow gusts across the window.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 420;
    lfo.connect(lfoGain).connect(band.frequency);
    lfo.start();

    src.connect(shelf).connect(band).connect(gain).connect(bus);
    src.start();
    this.rainNodes = { src, gain, lfo };

    this.scheduleThunder();
    this.scheduleRaindrop();
  }

  stopAmbience(): void {
    if (this.thunderTimer) clearTimeout(this.thunderTimer);
    if (this.raindropTimer) clearTimeout(this.raindropTimer);
    this.thunderTimer = null;
    this.raindropTimer = null;
    const r = this.rainNodes;
    if (r && this.ctx) {
      const t = this.ctx.currentTime;
      r.gain.gain.cancelScheduledValues(t);
      r.gain.gain.setValueAtTime(Math.max(r.gain.gain.value, 0.0002), t);
      r.gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      setTimeout(() => {
        try {
          r.src.stop();
          r.lfo.stop();
        } catch {}
      }, 1400);
    }
    this.rainNodes = null;
  }

  setAmbienceEnabled(on: boolean): void {
    this.ambienceEnabled = on;
    if (!on) this.stopAmbience();
    else if (this.ctx) this.startAmbience();
  }

  private scheduleThunder(): void {
    if (!this.ctx) return;
    const delay = 9000 + Math.random() * 26000;
    this.thunderTimer = setTimeout(() => {
      if (this.ambienceEnabled && this.rainNodes) this.thunder(0.4 + Math.random() * 0.5);
      this.scheduleThunder();
    }, delay);
  }

  private scheduleRaindrop(): void {
    if (!this.ctx) return;
    this.raindropTimer = setTimeout(
      () => {
        if (this.ambienceEnabled && this.rainNodes) this.raindrop();
        this.scheduleRaindrop();
      },
      260 + Math.random() * 900,
    );
  }

  thunder(intensity = 0.7): void {
    if (!this.ctx || !this.ambienceBus) return;
    const ctx = this.ctx;

    // Rolling rumble
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 2.6);
    src.connect(lp);
    this.env(lp, this.ambienceBus, 0.06, 2.8, 0.5 * intensity);
    src.start();
    src.stop(ctx.currentTime + 3.4);

    // Crack
    const crack = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    crack.connect(bp);
    this.env(bp, this.ambienceBus, 0.005, 0.5, 0.28 * intensity);
    crack.start();
    crack.stop(ctx.currentTime + 0.8);
  }

  raindrop(): void {
    if (!this.ctx || !this.ambienceBus) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + Math.random() * 2600;
    bp.Q.value = 6;
    src.connect(bp);
    this.env(bp, this.ambienceBus, 0.002, 0.05 + Math.random() * 0.06, 0.13);
    src.start();
    src.stop(ctx.currentTime + 0.2);
  }

  /* ---------------------------------------------------------------- */
  /* Wooden dice                                                      */
  /* ---------------------------------------------------------------- */

  /** A tumbling rattle: many small wooden clacks that settle into a final knock. */
  diceRoll(durationMs = 1050): void {
    if (!this.ctx || !this.musicBus) return;
    const hits = 9 + Math.floor(Math.random() * 4);
    let t = 0;
    for (let i = 0; i < hits; i++) {
      const progress = i / hits;
      const gap = (durationMs / hits) * (0.55 + Math.random() * 0.9);
      t += gap;
      this.diceClack(Math.min(1, 0.35 + progress * 0.8) * (0.55 + Math.random() * 0.5), t / 1000);
    }
    // Final settle.
    this.diceClack(1, (t + 90) / 1000);
    this.diceClack(0.7, (t + 170) / 1000);
  }

  private diceClack(intensity: number, start: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;

    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 + Math.random() * 2200;
    bp.Q.value = 2.4;
    src.connect(bp);
    this.env(bp, this.musicBus, 0.001, 0.035 + Math.random() * 0.05, 0.2 * intensity, start);
    src.start(ctx.currentTime + start);
    src.stop(ctx.currentTime + start + 0.2);

    // Wooden body resonance.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 110 + Math.random() * 90;
    this.env(osc, this.musicBus, 0.001, 0.09, 0.12 * intensity, start);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + 0.25);
  }

  /* ---------------------------------------------------------------- */
  /* Paper, dossiers, wax                                             */
  /* ---------------------------------------------------------------- */

  /** Shuffling a dossier across the table. */
  paperShuffle(count = 5): void {
    if (!this.ctx || !this.musicBus) return;
    let t = 0;
    for (let i = 0; i < count; i++) {
      t += 60 + Math.random() * 130;
      const ctx = this.ctx;
      const src = this.noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800 + Math.random() * 1400;
      src.connect(hp);
      this.env(hp, this.musicBus, 0.004, 0.1 + Math.random() * 0.1, 0.1 + Math.random() * 0.07, t / 1000);
      src.start(ctx.currentTime + t / 1000);
      src.stop(ctx.currentTime + t / 1000 + 0.3);
    }
  }

  /** A card sliding out of a hand and face-down across the baize. */
  cardDeal(index = 0): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const start = index * 0.09;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, ctx.currentTime + start);
    bp.frequency.exponentialRampToValueAtTime(3200, ctx.currentTime + start + 0.22);
    bp.Q.value = 1.1;
    src.connect(bp);
    this.env(bp, this.musicBus, 0.01, 0.26, 0.16, start);
    src.start(ctx.currentTime + start);
    src.stop(ctx.currentTime + start + 0.5);
  }

  sealOpen(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    this.paperShuffle(3);
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 1.4;
    src.connect(bp);
    this.env(bp, this.musicBus, 0.002, 0.35, 0.3);
    src.start();
    src.stop(ctx.currentTime + 0.6);
  }

  /** Rubber stamp on the notebook: a soft thud. */
  stamp(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    src.connect(lp);
    this.env(lp, this.musicBus, 0.002, 0.09, 0.26);
    src.start();
    src.stop(ctx.currentTime + 0.25);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 150;
    this.env(osc, this.musicBus, 0.002, 0.12, 0.22);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  /** Ink on paper: a fountain-pen scratch. */
  ink(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3400;
    bp.Q.value = 3;
    src.connect(bp);
    this.env(bp, this.musicBus, 0.01, 0.22, 0.06);
    src.start();
    src.stop(ctx.currentTime + 0.4);
  }

  typeKey(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + Math.random() * 1200;
    bp.Q.value = 5;
    src.connect(bp);
    this.env(bp, this.musicBus, 0.001, 0.03, 0.07);
    src.start();
    src.stop(ctx.currentTime + 0.12);
  }

  /* ---------------------------------------------------------------- */
  /* Drama                                                            */
  /* ---------------------------------------------------------------- */

  /** A brass minor chord when a theory is put to the table. */
  stinger(kind: 'suggest' | 'disprove' | 'unrefuted' | 'eliminated' | 'turn' | 'reveal' = 'suggest'): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastStinger < 0.35) return;
    this.lastStinger = now;

    const triad =
      kind === 'unrefuted'
        ? MINOR_TRIADS[0]
        : kind === 'eliminated'
          ? [146.83, 185, 220, 293.66]
          : kind === 'disprove'
            ? MINOR_TRIADS[2]
            : MINOR_TRIADS[Math.floor(Math.random() * MINOR_TRIADS.length)];

    const swell = kind === 'unrefuted' ? 1.6 : 1.1;
    triad.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq * (kind === 'eliminated' ? 0.5 : 1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(400, now);
      lp.frequency.exponentialRampToValueAtTime(2600, now + 0.25);
      lp.Q.value = 4;
      osc.connect(lp);
      this.env(lp, this.musicBus!, 0.09 + i * 0.02, swell * 1.35, 0.1, 0);
      osc.start(now);
      osc.stop(now + swell * 1.6 + 0.4);
    });

    // A low timpani punch under it.
    const drum = ctx.createOscillator();
    drum.type = 'sine';
    drum.frequency.setValueAtTime(120, now);
    drum.frequency.exponentialRampToValueAtTime(48, now + 0.6);
    this.env(drum, this.musicBus, 0.006, 0.85, 0.32);
    drum.start(now);
    drum.stop(now + 1.6);
  }

  /** Courtroom gavel. */
  gavel(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const bang = (start: number, gain: number) => {
      const src = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.7;
      src.connect(bp);
      this.env(bp, this.musicBus!, 0.001, 0.16, 0.5 * gain, start);
      src.start(ctx.currentTime + start);
      src.stop(ctx.currentTime + start + 0.5);

      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(240, ctx.currentTime + start);
      body.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + start + 0.25);
      this.env(body, this.musicBus!, 0.002, 0.3, 0.4 * gain, start);
      body.start(ctx.currentTime + start);
      body.stop(ctx.currentTime + start + 0.6);
    };
    bang(0, 1);
    bang(0.34, 0.85);
    bang(0.66, 0.7);
  }

  /** Brass fanfare for a solved case. */
  fanfare(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const notes = [220, 261.63, 329.63, 440, 523.25];
    notes.forEach((freq, i) => {
      const start = i * 0.14;
      [1, 2].forEach((mult, k) => {
        const osc = ctx.createOscillator();
        osc.type = k === 0 ? 'sawtooth' : 'square';
        osc.frequency.value = freq * mult;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3200;
        osc.connect(lp);
        this.env(lp, this.musicBus!, 0.03, 0.9, 0.09 / (k + 1), start);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 1.6);
      });
    });
    this.stinger('unrefuted');
  }

  /** Soft bell announcing whose turn it is now. */
  turnBell(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      this.env(osc, this.musicBus!, 0.004, 1.5 - i * 0.5, 0.07 / (i + 1));
      osc.start(now);
      osc.stop(now + 2.2);
    });
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    modulator.frequency.value = 6;
    modGain.gain.value = 8;
    modulator.connect(modGain).connect(this.musicBus);
    modulator.start(now);
    modulator.stop(now + 1.4);
  }

  /** A single dry click — buttons, tokens, doors. */
  click(pitch = 1600, gain = 0.12): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = pitch;
    bp.Q.value = 4;
    src.connect(bp);
    this.env(bp, this.musicBus, 0.001, 0.05, gain);
    src.start();
    src.stop(ctx.currentTime + 0.15);
  }

  doorOpen(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(96, ctx.currentTime + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    osc.connect(lp);
    this.env(lp, this.musicBus, 0.03, 0.5, 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 1);
  }

  /** Distant footsteps on parquet for the token slide. */
  footstep(count = 1): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    for (let i = 0; i < count; i++) {
      const start = i * 0.16;
      const src = this.noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100 + Math.random() * 400;
      src.connect(lp);
      this.env(lp, this.musicBus, 0.003, 0.09, 0.12, start);
      src.start(ctx.currentTime + start);
      src.stop(ctx.currentTime + start + 0.3);
    }
  }
}

export const audio = new NoirAudio();

/** Named cues used by the UI layer. */
export function playCue(name: string): void {
  const a = audio;
  if (!a.sfxEnabled || !a.ctx) return;
  switch (name) {
    case 'deal':
      a.cardDeal(0);
      break;
    case 'deal-many':
      for (let i = 0; i < 6; i++) a.cardDeal(i);
      break;
    case 'shuffle':
      a.paperShuffle(6);
      break;
    case 'dice':
      a.diceRoll();
      break;
    case 'move':
      a.footstep(1);
      break;
    case 'passage':
      a.doorOpen();
      break;
    case 'suggest':
      a.stinger('suggest');
      break;
    case 'disprove':
      a.stinger('disprove');
      break;
    case 'reveal':
      a.ink();
      break;
    case 'unrefuted':
      a.stinger('unrefuted');
      break;
    case 'eliminated':
      a.gavel();
      break;
    case 'gavel':
      a.gavel();
      break;
    case 'seal':
      a.sealOpen();
      break;
    case 'stamp':
      a.stamp();
      break;
    case 'type':
      a.typeKey();
      break;
    case 'turn':
      a.turnBell();
      break;
    case 'win':
      a.fanfare();
      break;
    case 'click':
      a.click();
      break;
    default:
      break;
  }
}
