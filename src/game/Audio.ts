import { rand, pick, clamp } from "./utils";

type Ctx = AudioContext;

/**
 * Everything you hear is synthesised at runtime — no audio files, no network.
 * Screams are formant-filtered sawtooths, which is exactly what a client sounds like.
 */
export class SynthAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loops = new Map<string, { gain: GainNode; stop: () => void }>();
  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private playingMusic = false;
  muted = false;
  unlocked = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("clientmania.muted") === "1";
    } catch {
      this.muted = false;
    }
  }

  unlock(): void {
    if (this.unlocked) {
      void this.ctx?.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.75;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.24;
    this.music.connect(this.master);

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.unlocked = true;
    void ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem("clientmania.muted", muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, this.ctx.currentTime + 0.08);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ---------------------------------------------------------------- primitives

  private t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(
    type: OscillatorType,
    freq: number,
    dur: number,
    gain: number,
    opts: { to?: number; delay?: number; pan?: number; filter?: number; q?: number; dest?: AudioNode } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = this.t() + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = g;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = opts.filter;
      f.Q.value = opts.q ?? 0.8;
      g.connect(f);
      node = f;
    }
    if (opts.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(opts.pan, -1, 1);
      node.connect(p);
      node = p;
    }
    node.connect(opts.dest ?? this.sfx);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noiseBurst(
    dur: number,
    gain: number,
    filterType: BiquadFilterType,
    freq: number,
    opts: { to?: number; delay?: number; q?: number; pan?: number; dest?: AudioNode } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.sfx) return;
    const t0 = this.t() + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (opts.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = g;
    if (opts.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(opts.pan, -1, 1);
      node.connect(p);
      node = p;
    }
    src.connect(f).connect(g);
    node.connect(opts.dest ?? this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private makeLoop(
    key: string,
    build: (ctx: Ctx, dest: AudioNode) => { gain: GainNode; stop: () => void },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.loops.has(key)) return;
    const node = build(ctx, this.sfx);
    node.gain.gain.value = 0.0001;
    this.loops.set(key, node);
  }

  /** Start or stop a sustained weapon loop. */
  loop(key: "flame" | "water" | "chainsaw" | "laser", on: boolean): void {
    if (!this.ctx) return;
    if (!on) {
      const l = this.loops.get(key);
      if (l) {
        l.gain.gain.cancelScheduledValues(this.t());
        l.gain.gain.setTargetAtTime(0.0001, this.t(), 0.05);
      }
      return;
    }
    if (!this.loops.has(key)) {
      if (key === "flame") {
        this.makeLoop(key, (c, dest) => {
          const src = c.createBufferSource();
          src.buffer = this.noise;
          src.loop = true;
          const f = c.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 900;
          const g = c.createGain();
          src.connect(f).connect(g).connect(dest);
          src.start();
          return { gain: g, stop: () => src.stop() };
        });
      } else if (key === "water") {
        this.makeLoop(key, (c, dest) => {
          const src = c.createBufferSource();
          src.buffer = this.noise;
          src.loop = true;
          const f = c.createBiquadFilter();
          f.type = "bandpass";
          f.frequency.value = 1400;
          f.Q.value = 0.7;
          const g = c.createGain();
          src.connect(f).connect(g).connect(dest);
          src.start();
          return { gain: g, stop: () => src.stop() };
        });
      } else if (key === "chainsaw") {
        this.makeLoop(key, (c, dest) => {
          const osc = c.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = 62;
          const lfo = c.createOscillator();
          lfo.frequency.value = 33;
          const lfoGain = c.createGain();
          lfoGain.gain.value = 12;
          lfo.connect(lfoGain).connect(osc.frequency);
          const f = c.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 700;
          const g = c.createGain();
          osc.connect(f).connect(g).connect(dest);
          osc.start();
          lfo.start();
          return { gain: g, stop: () => { osc.stop(); lfo.stop(); } };
        });
      } else {
        this.makeLoop(key, (c, dest) => {
          const osc = c.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = 420;
          const osc2 = c.createOscillator();
          osc2.type = "square";
          osc2.frequency.value = 424;
          const f = c.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 2600;
          const g = c.createGain();
          osc.connect(f);
          osc2.connect(f);
          f.connect(g).connect(dest);
          osc.start();
          osc2.start();
          return { gain: g, stop: () => { osc.stop(); osc2.stop(); } };
        });
      }
    }
    const l = this.loops.get(key);
    if (l && this.ctx) {
      l.gain.gain.cancelScheduledValues(this.t());
      l.gain.gain.setTargetAtTime(key === "chainsaw" ? 0.05 : 0.11, this.t(), 0.06);
    }
  }

  stopAllLoops(): void {
    for (const key of ["flame", "water", "chainsaw", "laser"] as const) this.loop(key, false);
  }

  // ------------------------------------------------------------------- effects

  ui(): void {
    this.tone("square", 760, 0.055, 0.05, { to: 1180 });
  }

  hover(): void {
    this.tone("sine", 340, 0.03, 0.025, { to: 420 });
  }

  swing(): void {
    this.noiseBurst(0.18, 0.09, "bandpass", 500, { to: 2400, q: 2 });
  }

  hammer(): void {
    this.tone("sine", 120, 0.32, 0.5, { to: 34 });
    this.noiseBurst(0.18, 0.25, "lowpass", 1400, { to: 180 });
    this.noiseBurst(0.4, 0.08, "bandpass", 2600, { q: 6 });
  }

  gun(): void {
    this.noiseBurst(0.09, 0.3, "highpass", 900, { to: 2400 });
    this.tone("sine", 210, 0.12, 0.28, { to: 60 });
    this.noiseBurst(0.22, 0.05, "bandpass", 3200, { q: 5 });
  }

  splat(): void {
    this.noiseBurst(0.14, 0.2, "lowpass", 900, { to: 260 });
    this.tone("sine", 300, 0.12, 0.12, { to: 90 });
  }

  zap(): void {
    this.noiseBurst(0.22, 0.24, "highpass", 2200, { to: 400 });
    this.tone("sawtooth", 1400, 0.3, 0.12, { to: 80, filter: 3000 });
    this.tone("square", 70, 0.3, 0.12, { to: 40 });
  }

  explode(): void {
    this.noiseBurst(0.85, 0.45, "lowpass", 1600, { to: 90 });
    this.tone("sine", 92, 0.8, 0.55, { to: 26 });
    this.noiseBurst(0.14, 0.2, "highpass", 3000);
  }

  squish(): void {
    this.noiseBurst(0.12, 0.14, "bandpass", 700, { to: 220, q: 3 });
    this.tone("sine", 260, 0.12, 0.1, { to: 100 });
  }

  hit(): void {
    this.noiseBurst(0.05, 0.08, "bandpass", 1600, { q: 2 });
  }

  hurt(): void {
    this.tone("sawtooth", 180, 0.28, 0.16, { to: 60, filter: 900 });
    this.noiseBurst(0.25, 0.16, "lowpass", 500);
  }

  pop(): void {
    this.tone("sine", 420, 0.07, 0.12, { to: 180 });
  }

  pin(): void {
    this.tone("triangle", 1900, 0.05, 0.045, { to: 2600 });
  }

  whoosh(): void {
    this.noiseBurst(0.3, 0.14, "bandpass", 260, { to: 2200, q: 3 });
  }

  rage(): void {
    this.tone("sawtooth", 220, 0.9, 0.2, { to: 55, filter: 1800 });
    this.tone("sawtooth", 330, 0.9, 0.14, { to: 82, filter: 1800 });
    this.noiseBurst(1.1, 0.22, "lowpass", 2600, { to: 120 });
  }

  wave(): void {
    this.tone("triangle", 330, 0.4, 0.12, { to: 660 });
    this.tone("triangle", 440, 0.5, 0.1, { to: 880, delay: 0.12 });
  }

  death(): void {
    this.tone("sawtooth", 180, 1.4, 0.2, { to: 28, filter: 900 });
    this.noiseBurst(1.2, 0.2, "lowpass", 900, { to: 80 });
  }

  /** Formant-filtered complaint. pitch 0.8–1.3. */
  scream(pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = this.t() + rand(0, 0.04);
    const dur = rand(0.45, 0.8);
    const base = rand(260, 420) * pitch;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.linearRampToValueAtTime(base * rand(1.2, 1.55), t0 + dur * 0.25);
    osc.frequency.exponentialRampToValueAtTime(base * 0.72, t0 + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = rand(5, 8);
    const vibGain = ctx.createGain();
    vibGain.gain.value = base * 0.035;
    vib.connect(vibGain).connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = rand(600, 900);
    f1.Q.value = 7;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = rand(1100, 1700);
    f2.Q.value = 9;

    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.7, 0.7);
    osc.connect(g);
    g.connect(f1).connect(p);
    g.connect(f2).connect(p);
    p.connect(this.sfx);
    osc.start(t0);
    vib.start(t0);
    osc.stop(t0 + dur + 0.1);
    vib.stop(t0 + dur + 0.1);
  }

  // --------------------------------------------------------------------- music

  startMusic(): void {
    if (!this.ctx || !this.music) return;
    if (this.playingMusic) return;
    this.playingMusic = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    const tick = (): void => {
      if (!this.ctx || !this.playingMusic) return;
      while (this.nextStepTime < this.ctx.currentTime + 0.12) {
        this.scheduleStep(this.step, this.nextStepTime);
        this.step = (this.step + 1) % 64;
        this.nextStepTime += 60 / 132 / 4;
      }
    };
    tick();
    this.schedulerId = window.setInterval(tick, 30);
  }

  stopMusic(): void {
    this.playingMusic = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  private scheduleStep(step: number, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    const dest = this.music;
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // Kick — four on the floor, with a syncopated ghost.
    if (s === 0 || s === 4 || s === 8 || s === 12 || (bar % 2 === 1 && s === 14)) {
      this.musicTone("sine", 130, 46, 0.55, when, 0.16, dest);
      this.noiseHit(0.025, 0.06, "highpass", 3000, when, dest);
    }
    // Snare / clap on 2 and 4.
    if (s === 4 || s === 12) {
      this.noiseHit(0.11, 0.15, "bandpass", 1900, when, dest, 1.4);
      this.musicTone("triangle", 190, 120, 0.09, when, 0.08, dest);
    }
    // Hats.
    if (s % 2 === 0) this.noiseHit(0.028, s % 4 === 0 ? 0.06 : 0.032, "highpass", 7200, when, dest);
    if (bar % 4 === 3 && s >= 12) this.noiseHit(0.05, 0.04, "highpass", 6200, when, dest);

    // Bass line: A minor, four-bar loop.
    const roots = [0, 0, 3, 5]; // A, A, C, D relative to A1
    const pattern = [0, -1, 0, -1, 7, -1, 0, -1, 12, -1, 7, -1, 3, -1, 5, -1];
    const note = pattern[s];
    if (note !== undefined && note >= 0) {
      const semis = roots[bar]! + note;
      const freq = 55 * Math.pow(2, semis / 12);
      this.musicTone("sawtooth", freq * 2, freq * 1.98, 0.16, when, 0.18, dest, 420);
    }

    // Sparse stab to keep it sinister.
    if (bar % 4 === 2 && (s === 7 || s === 15)) {
      this.musicTone("square", 220, 218, 0.05, when, 0.5, dest, 900);
      this.musicTone("square", 261, 259, 0.045, when, 0.5, dest, 900);
      this.musicTone("square", 329, 327, 0.04, when, 0.5, dest, 900);
    }
  }

  private musicTone(
    type: OscillatorType,
    freq: number,
    to: number,
    gain: number,
    when: number,
    dur: number,
    dest: AudioNode,
    filter?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filter;
      osc.connect(f).connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(dest);
    osc.start(when);
    osc.stop(when + dur + 0.03);
  }

  private noiseHit(
    dur: number,
    gain: number,
    type: BiquadFilterType,
    freq: number,
    when: number,
    dest: AudioNode,
    q = 1,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  /** Small random vocal taunt, used sparingly. */
  taunt(): void {
    this.scream(pick([0.85, 1, 1.15, 1.3]));
  }

  dispose(): void {
    this.stopMusic();
    this.stopAllLoops();
    void this.ctx?.close();
    this.ctx = null;
  }
}
