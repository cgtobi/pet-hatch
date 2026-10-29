/**
 * Sound and touch feedback: a tiny WebAudio synth for effects, generative background music,
 * and named vibration patterns. Everything is made in code; there are no audio files.
 */

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let soundOn = true;
let musicOn = true;
let hapticsOn = true;

const SFX_VOLUME = 0.9;
const MUSIC_VOLUME = 0.32;

export function setSoundEnabled(on: boolean): void {
  soundOn = on;
  if (ctx && sfxBus) sfxBus.gain.setTargetAtTime(on ? SFX_VOLUME : 0, ctx.currentTime, 0.05);
}

export function setMusicEnabled(on: boolean): void {
  musicOn = on;
  if (ctx && musicBus) musicBus.gain.setTargetAtTime(on ? MUSIC_VOLUME : 0, ctx.currentTime, 0.4);
}

export function setHapticsEnabled(on: boolean): void {
  hapticsOn = on;
}

/** A short, soft room so sounds don't feel dry: decaying noise as an impulse response. */
function makeReverb(c: AudioContext): ConvolverNode {
  const len = Math.floor(c.sampleRate * 1.4);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const conv = c.createConvolver();
  conv.buffer = buf;
  return conv;
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.connect(ctx.destination);
    const reverb = makeReverb(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    reverb.connect(wet).connect(comp);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = soundOn ? SFX_VOLUME : 0;
    sfxBus.connect(comp);
    sfxBus.connect(reverb);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? MUSIC_VOLUME : 0;
    musicBus.connect(comp);
    musicBus.connect(reverb);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  music.wake();
}

/** Pause all audio while the app is in the background. */
export function suspendAudio(hidden: boolean): void {
  if (!ctx) return;
  if (hidden) void ctx.suspend();
  else void ctx.resume();
}

// ---------- haptics ----------

const PATTERNS = {
  /** Barely there: strokes, small confirmations. */
  tick: 5,
  tap: 8,
  press: 15,
  crack: 20,
  hit: 25,
  warn: 30,
  success: [10, 50, 10],
  crit: [30, 40, 30],
  celebrate: [20, 60, 20, 60, 40],
  hatch: [30, 40, 80],
} satisfies Record<string, number | number[]>;

export type Haptic = keyof typeof PATTERNS;

export function haptic(kind: Haptic): void {
  if (!hapticsOn) return;
  // Vibrating before the first real tap only produces console warnings.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate?.(PATTERNS[kind]);
}

/** Whether this device can vibrate at all (iPhones can't from the web), so the setting only shows where it works. */
export const canVibrate = typeof navigator.vibrate === 'function';

// ---------- synth voices ----------

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  slideTo?: number;
  attack?: number;
  /** Destination bus; effects by default. */
  bus?: AudioNode | null;
}

function tone(freq: number, at: number, dur: number, o: ToneOpts = {}): void {
  const bus = o.bus === undefined ? sfxBus : o.bus;
  if (!ctx || !bus) return;
  const t0 = Math.max(ctx.currentTime, at);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
  const attack = o.attack ?? 0.012;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(o.vol ?? 0.12, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
  osc.connect(gain).connect(bus);
  osc.start(t0);
  osc.stop(t0 + attack + dur + 0.02);
}

/** Music-box style note: a sine with a quiet octave partial and a quick decay. */
function chime(freq: number, at: number, vol = 0.1, bus: AudioNode | null = sfxBus): void {
  tone(freq, at, 0.5, { vol, bus });
  tone(freq * 2, at, 0.25, { vol: vol * 0.3, bus });
}

function noise(at: number, dur: number, vol: number, filterFreq: number, q = 1): void {
  if (!ctx || !sfxBus) return;
  const t0 = Math.max(ctx.currentTime, at);
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(sfxBus);
  src.start(t0);
}

const now = () => ctx?.currentTime ?? 0;
const C5 = 523.25;
/** Semitones above C5. */
const note = (semi: number) => C5 * Math.pow(2, semi / 12);

export const sfx = {
  tap: () => tone(700, now(), 0.07, { type: 'triangle', vol: 0.09, slideTo: 980 }),
  warm: () => tone(220, now(), 0.35, { vol: 0.05, slideTo: 280, attack: 0.08 }),
  mist: () => noise(now(), 0.4, 0.22, 3500, 0.7),
  turn: () => {
    tone(330, now(), 0.22, { type: 'triangle', vol: 0.09, slideTo: 520 });
    noise(now(), 0.18, 0.08, 900);
  },
  sing: () => [0, 4, 7, 4, 12].forEach((s, i) => chime(note(s), now() + i * 0.14, 0.09)),
  nope: () => tone(260, now(), 0.14, { type: 'square', vol: 0.035, slideTo: 200 }),
  toggle: () => tone(440, now(), 0.05, { type: 'square', vol: 0.03 }),
  crack: () => {
    noise(now(), 0.07, 0.55, 1900, 2);
    noise(now() + 0.05, 0.05, 0.3, 2600, 3);
    tone(900, now(), 0.05, { type: 'square', vol: 0.03, slideTo: 500 });
  },
  eat: () =>
    [0, 0.17, 0.34].forEach((at) => {
      noise(now() + at, 0.06, 0.25, 1300, 1.5);
      tone(300, now() + at, 0.07, { type: 'triangle', vol: 0.05, slideTo: 220 });
    }),
  play: () => [0, 7, 4, 12].forEach((s, i) => chime(note(s), now() + i * 0.1, 0.1)),
  cure: () => [7, 12, 16].forEach((s, i) => chime(note(s), now() + i * 0.08, 0.09)),
  scold: () => tone(190, now(), 0.25, { type: 'sawtooth', vol: 0.05, slideTo: 120 }),
  grow: () => [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => chime(note(s - 5), now() + i * 0.09, 0.1)),
  hatch: () => {
    noise(now(), 0.3, 0.5, 1400, 0.8);
    [0, 4, 7, 12, 16].forEach((s, i) => chime(note(s), now() + 0.15 + i * 0.09, 0.12));
  },
  hit: () => tone(784, now(), 0.07, { type: 'triangle', vol: 0.08, slideTo: 1047 }),
  miss: () => tone(220, now(), 0.12, { type: 'triangle', vol: 0.05, slideTo: 160 }),
  /** A battle blow: a thump plus a falling tone. */
  strike: (heavy = false) => {
    noise(now(), heavy ? 0.22 : 0.14, heavy ? 0.6 : 0.4, 500, 0.8);
    tone(heavy ? 260 : 330, now(), 0.16, { type: 'triangle', vol: 0.09, slideTo: 110 });
  },
  whoosh: () => noise(now(), 0.25, 0.18, 1800, 0.5),
  faint: () => tone(440, now(), 0.7, { type: 'triangle', vol: 0.08, slideTo: 110 }),
  win: () => [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => chime(note(s), now() + i * (i < 4 ? 0.11 : 0.16), 0.11)),
  lose: () => [7, 4, 0, -5].forEach((s, i) => chime(note(s - 12), now() + i * 0.22, 0.09)),
};

// ---------- background music ----------

export type MusicMode = 'day' | 'night' | 'battle' | 'off';

interface Style {
  bpm: number;
  /** Melody notes as semitones above the root. */
  scale: number[];
  root: number;
  /** Chance a step plays a melody note. */
  density: number;
  /** Chord per two-bar phrase: root (semitones) and whether it is minor. */
  chords: [number, boolean][];
  pulse: boolean;
}

const STYLES: Record<Exclude<MusicMode, 'off'>, Style> = {
  // C major pentatonic music box over I–vi–IV–V pads.
  day: {
    bpm: 84,
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    root: 0,
    density: 0.42,
    chords: [[0, false], [-3, true], [5, false], [7, false]],
    pulse: false,
  },
  // Slower, lower and sparser: a lullaby.
  night: {
    bpm: 60,
    scale: [0, 2, 4, 7, 9, 12],
    root: -12,
    density: 0.24,
    chords: [[0, false], [-3, true], [5, false], [0, false]],
    pulse: false,
  },
  // A minor pentatonic over a bass pulse.
  battle: {
    bpm: 132,
    scale: [0, 3, 5, 7, 10, 12, 15],
    root: -3,
    density: 0.55,
    chords: [[0, true], [0, true], [-4, false], [-2, false]],
    pulse: true,
  },
};

/** Generative music: notes are scheduled a little ahead of time, so a coarse timer is enough. */
class Music {
  private mode: MusicMode = 'off';
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private degree = 4;

  set(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.step = 0;
    this.wake();
  }

  /** Start scheduling if there is something to play and audio is unlocked. */
  wake(): void {
    if (this.timer || this.mode === 'off' || !ctx) return;
    this.nextTime = ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 200);
  }

  private schedule(): void {
    if (!ctx || this.mode === 'off') {
      clearInterval(this.timer);
      this.timer = 0;
      return;
    }
    if (!musicOn || ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.2;
      return;
    }
    const style = STYLES[this.mode];
    const stepDur = 60 / style.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.6) {
      this.playStep(style, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(style: Style, at: number, stepDur: number): void {
    const [chord, minor] = style.chords[Math.floor(this.step / 16) % style.chords.length];
    const root = chord + style.root;
    if (this.step % 16 === 0) {
      for (const s of [0, minor ? 3 : 4, 7]) {
        tone(note(root + s - 24), at, stepDur * 15, { vol: 0.05, attack: 0.8, bus: musicBus });
      }
    }
    if (style.pulse && this.step % 2 === 0) {
      tone(note(root - 24), at, stepDur * 0.8, { type: 'triangle', vol: 0.06, bus: musicBus });
    }
    // Melody: a random walk over the scale, so phrases sound related.
    if (Math.random() < style.density) {
      const step = Math.round((Math.random() - 0.5) * 4);
      this.degree = Math.max(0, Math.min(style.scale.length - 1, this.degree + step));
      const semi = style.scale[this.degree] + style.root;
      if (style.pulse) tone(note(semi), at, stepDur * 1.2, { type: 'square', vol: 0.025, bus: musicBus });
      else chime(note(semi), at, 0.06, musicBus);
    }
  }
}

const music = new Music();

export function setMusicMode(mode: MusicMode): void {
  music.set(mode);
}
