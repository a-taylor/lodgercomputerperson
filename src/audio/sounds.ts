// Every sound in the game, synthesised with Web Audio: no sample files. Chip-ish on purpose, in
// keeping with a 1985 home computer. Each function schedules its notes and returns at once.

export class Sounds {
  readonly ctx: AudioContext;
  private master: GainNode;
  private noiseBuf: AudioBuffer;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setVolume(v: number): void {
    // Square it so the slider feels even to the ear.
    this.master.gain.setTargetAtTime(v * v, this.now, 0.02);
  }

  /** One note with a quick attack and an exponential fade. */
  tone(freq: number, at: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number; to?: AudioNode } = {}): void {
    const { type = 'square', gain = 0.1, attack = 0.005, to = this.master } = opts;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(to);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** A burst of filtered noise. */
  noise(at: number, dur: number, opts: { gain?: number; filter?: BiquadFilterType; freq?: number; q?: number } = {}): void {
    const { gain = 0.1, filter = 'lowpass', freq = 1000, q = 1 } = opts;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  /** Steady filtered noise (running water, TV hiss) until stopped. Returns its gain to shape or fade. */
  hum(opts: { filter: BiquadFilterType; freq: number; q?: number; gain: number }): { gain: GainNode; stop: () => void } {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.filter;
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.now);
    g.gain.linearRampToValueAtTime(opts.gain, this.now + 0.15);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return {
      gain: g,
      stop: () => {
        g.gain.cancelScheduledValues(this.now);
        g.gain.setTargetAtTime(0, this.now, 0.08);
        src.stop(this.now + 0.5);
      },
    };
  }

  // Named sounds.

  knock(): void {
    for (let i = 0; i < 3; i++) {
      const at = this.now + i * 0.17;
      this.noise(at, 0.07, { gain: 0.5, freq: 500 });
      this.tone(95, at, 0.12, { type: 'sine', gain: 0.5 });
    }
  }

  /** One "ring ring": two bell trills. */
  ring(): void {
    for (const start of [0, 0.55]) {
      for (let i = 0; i < 16; i++) {
        const at = this.now + start + i * 0.025;
        this.tone(i % 2 ? 1180 : 940, at, 0.03, { gain: 0.05 });
      }
    }
  }

  alarm(): void {
    for (let i = 0; i < 50; i++) this.tone(i % 2 ? 1560 : 1320, this.now + i * 0.03, 0.035, { gain: 0.05 });
  }

  step(stairs: boolean): void {
    this.noise(this.now, 0.04, { gain: 0.12, freq: stairs ? 900 : 600 + Math.random() * 200 });
  }

  door(): void {
    this.noise(this.now, 0.05, { gain: 0.2, filter: 'bandpass', freq: 2200, q: 4 });
    this.noise(this.now + 0.35, 0.12, { gain: 0.5, freq: 300 });
    this.tone(70, this.now + 0.35, 0.15, { type: 'sine', gain: 0.4 });
  }

  pat(): void {
    this.tone(660, this.now, 0.15, { type: 'triangle', gain: 0.12 });
    this.tone(880, this.now + 0.09, 0.22, { type: 'triangle', gain: 0.12 });
  }

  piano(freq: number, at = this.now): void {
    this.tone(freq, at, 1.1, { type: 'triangle', gain: 0.14, attack: 0.003 });
    this.tone(freq * 2, at, 0.4, { type: 'sine', gain: 0.04, attack: 0.003 });
  }

  typeKey(): void {
    this.noise(this.now, 0.025, { gain: 0.25, filter: 'highpass', freq: 2500 });
    this.tone(180, this.now, 0.03, { type: 'square', gain: 0.03 });
  }

  typeBell(): void {
    this.tone(2093, this.now, 0.6, { type: 'sine', gain: 0.08 });
    this.noise(this.now + 0.15, 0.35, { gain: 0.08, filter: 'bandpass', freq: 1500, q: 2 });
  }

  sizzle(): void {
    this.noise(this.now, 0.08 + Math.random() * 0.1, { gain: 0.05, filter: 'highpass', freq: 4000 });
  }
}

/** Equal-tempered frequency of a MIDI note. */
export const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
