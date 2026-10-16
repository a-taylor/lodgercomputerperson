// Decides what to play by watching the sim each frame, the same way the renderer does: footsteps
// while he walks, the piano while he plays it, a knock when he knocks. Reads sim data only.
import { currentStep, type SimState } from '../sim/sim';
import type { World } from '../sim/world';
import { midi, Sounds } from './sounds';

/** Sounds that carry on while he's doing something. */
type Ambient = 'piano' | 'record' | 'tv' | 'typing' | 'bath' | 'tap' | 'sizzle';

const AMBIENT_AT: Record<string, Ambient> = {
  'den.piano': 'piano',
  'den.records': 'record',
  'den.tv': 'tv',
  'study.typewriter': 'typing',
  'bathroom.bath': 'bath',
  'bathroom.sink': 'tap',
  'kitchen.stove': 'sizzle',
};

export const CAPTIONS: Record<Ambient | 'door' | 'alarm', string> = {
  piano: '♪ piano ♪',
  record: '♪ a record plays ♪',
  tv: '*TV chatter*',
  typing: '*clack clack*',
  bath: '*splashing*',
  tap: '*tap running*',
  sizzle: '*sizzling*',
  door: '*door opens and shuts*',
  alarm: '*BRRRING*',
};

/** Two little records, as [melody note or null for a rest] per eighth, and a bass note per quarter. */
const TUNES: { melody: (number | null)[]; bass: number[] }[] = [
  {
    melody: [72, 76, 79, 76, 77, 74, 71, 74, 72, 76, 79, 84, 83, 79, 74, null],
    bass: [48, 55, 50, 55, 48, 52, 55, 43],
  },
  {
    melody: [69, 72, 76, 72, 74, 72, 71, 67, 69, 72, 76, 79, 77, 76, 74, null],
    bass: [45, 52, 50, 52, 45, 52, 50, 40],
  },
];
const EIGHTH = 0.22;
/** C major pentatonic over two octaves, for noodling on the piano. */
const PENTATONIC = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
const STEP_PX = 7;
const RING_EVERY_MS = 2200;

export interface SoundSettings {
  muted: boolean;
  /** 0 to 1. */
  volume: number;
  /** Caption ongoing sounds (piano, TV...) as well as knocks and the phone. */
  captions: boolean;
}

export class SoundDirector {
  private sounds: Sounds | null = null;
  private ambient: Ambient | null = null;
  private nextAt = 0;
  private beat = 0;
  private note = 4;
  private tune = 0;
  private hum: ReturnType<Sounds['hum']> | null = null;
  private keys = 0;
  private walked = 0;
  private lastStepMs = 0;
  private lastRingMs = -Infinity;
  private last: { knock: number; present: boolean; pat: number; x: number; y: number } | null = null;
  private event: { caption: string; untilMs: number } | null = null;

  constructor(public settings: SoundSettings) {
    // Browsers only let sound start from a click or key press.
    if (!settings.muted) {
      const wake = () => {
        this.start();
        removeEventListener('pointerdown', wake);
        removeEventListener('keydown', wake);
      };
      addEventListener('pointerdown', wake);
      addEventListener('keydown', wake);
    }
  }

  /** Call from a click or key handler. */
  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    if (muted) this.stopAmbient();
    else this.start();
  }

  setVolume(volume: number): void {
    this.settings.volume = volume;
    this.sounds?.setVolume(volume);
  }

  /** Pause everything while the tab is hidden; frames stop, so nothing would end the hums. */
  setHidden(hidden: boolean): void {
    if (!this.sounds) return;
    if (hidden) void this.sounds.ctx.suspend();
    else if (!this.settings.muted) void this.sounds.ctx.resume();
  }

  /** Sounds the sim doesn't record, played when the player does them. */
  cue(name: 'alarm'): void {
    this.event = { caption: CAPTIONS[name], untilMs: performance.now() + 1500 };
    if (this.playing) this.sounds!.alarm();
  }

  private get playing(): boolean {
    return !this.settings.muted && this.sounds !== null && this.sounds.ctx.state === 'running';
  }

  private start(): void {
    this.sounds ??= new Sounds();
    this.sounds.setVolume(this.settings.volume);
    void this.sounds.ctx.resume();
  }

  /** Plays whatever this frame calls for. Returns a caption for what's sounding, if any. */
  update(sim: SimState, world: World, px: number, py: number): string | null {
    const nowMs = performance.now();
    const p = sim.person;
    const here = p.present && p.alive;
    const lastPat = sim.pats.at(-1) ?? 0;
    const prev = this.last ?? { knock: sim.knock?.seq ?? 0, present: p.present, pat: lastPat, x: px, y: py };
    this.last = { knock: sim.knock?.seq ?? 0, present: p.present, pat: lastPat, x: px, y: py };
    const play = this.playing ? this.sounds! : null;

    // One-off events.
    if (sim.knock && sim.knock.seq !== prev.knock) play?.knock();
    if (p.present !== prev.present) {
      play?.door();
      this.event = { caption: CAPTIONS.door, untilMs: nowMs + 1500 };
    }
    if (lastPat !== prev.pat && lastPat !== 0) play?.pat();
    if (sim.phoneRing && sim.tick < sim.phoneRing.untilTick) {
      if (nowMs - this.lastRingMs > RING_EVERY_MS) {
        play?.ring();
        this.lastRingMs = nowMs;
      }
    } else this.lastRingMs = -Infinity;

    // Footsteps, by distance walked so they keep pace at any speed.
    if (here && p.path.length > 0) {
      this.walked += Math.hypot(px - prev.x, py - prev.y);
      if (this.walked >= STEP_PX && nowMs - this.lastStepMs > 90) {
        play?.step(py !== prev.y);
        this.walked = 0;
        this.lastStepMs = nowMs;
      }
    } else this.walked = 0;

    // Ongoing sounds.
    const run = p.activity;
    const next = here && run?.doing ? (AMBIENT_AT[run.node] ?? null) : null;
    // Asleep in the bath would be odd, but don't splash if so.
    const ambient = next && currentStep(sim, world)?.asleep ? null : next;
    if (ambient !== this.ambient) {
      this.stopAmbient();
      this.ambient = ambient;
      this.beat = 0;
      this.keys = 0;
      this.tune = (run?.startedMs ?? 0) % TUNES.length;
      this.nextAt = play ? play.now + 0.1 : 0;
    }
    if (play && ambient) this.playAmbient(play, ambient);
    else if (!play) this.stopAmbient(false);

    if (this.event && nowMs < this.event.untilMs) return this.event.caption;
    return this.settings.captions && ambient ? CAPTIONS[ambient] : null;
  }

  private playAmbient(s: Sounds, ambient: Ambient): void {
    if (this.nextAt === 0) this.nextAt = s.now + 0.1;
    const ahead = s.now + 0.15;
    switch (ambient) {
      case 'piano':
        while (this.nextAt < ahead) {
          this.note = Math.max(0, Math.min(PENTATONIC.length - 1, this.note + Math.round((Math.random() - 0.5) * 4)));
          s.piano(midi(PENTATONIC[this.note]!), this.nextAt);
          if (Math.random() < 0.2) s.piano(midi(PENTATONIC[Math.max(0, this.note - 2)]! - 12), this.nextAt);
          this.nextAt += 0.2 + Math.random() * 0.3;
        }
        break;
      case 'record': {
        const tune = TUNES[this.tune]!;
        while (this.nextAt < ahead) {
          const m = tune.melody[this.beat % tune.melody.length];
          if (m != null) s.tone(midi(m), this.nextAt, EIGHTH * 0.9, { type: 'square', gain: 0.035 });
          if (this.beat % 2 === 0) s.tone(midi(tune.bass[(this.beat / 2) % tune.bass.length]!), this.nextAt, EIGHTH * 1.6, { type: 'triangle', gain: 0.1 });
          this.beat++;
          this.nextAt += EIGHTH;
        }
        break;
      }
      case 'typing':
        if (s.now >= this.nextAt) {
          if (++this.keys % 32 === 0) {
            s.typeBell();
            this.nextAt = s.now + 0.9;
          } else {
            s.typeKey();
            this.nextAt = s.now + 0.08 + Math.random() * 0.17;
          }
        }
        break;
      case 'sizzle':
        if (s.now >= this.nextAt) {
          s.sizzle();
          this.nextAt = s.now + 0.05 + Math.random() * 0.15;
        }
        break;
      case 'tv':
        // Muffled voices: noise in the speech band, its level jumping syllable by syllable.
        this.hum ??= s.hum({ filter: 'bandpass', freq: 1100, q: 1.5, gain: 0.03 });
        if (s.now >= this.nextAt) {
          this.hum.gain.gain.setTargetAtTime(Math.random() < 0.25 ? 0.004 : 0.02 + Math.random() * 0.05, s.now, 0.03);
          this.nextAt = s.now + 0.1 + Math.random() * 0.15;
        }
        break;
      case 'bath':
        this.hum ??= s.hum({ filter: 'lowpass', freq: 1400, gain: 0.05 });
        break;
      case 'tap':
        this.hum ??= s.hum({ filter: 'bandpass', freq: 2500, q: 0.8, gain: 0.04 });
        break;
    }
  }

  private stopAmbient(forget = true): void {
    this.hum?.stop();
    this.hum = null;
    this.nextAt = 0;
    if (forget) this.ambient = null;
  }
}
