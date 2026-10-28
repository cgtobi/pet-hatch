/** Tiny WebAudio synth for chirps and bleeps, plus haptics where the device supports them. */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function buzz(ms: number | number[]): void {
  navigator.vibrate?.(ms);
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, slideTo?: number) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(at: number, dur: number, vol: number, filterFreq: number) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

export const sfx = {
  tap: () => tone(660, 0, 0.08, 'triangle', 0.1, 880),
  warm: () => tone(220, 0, 0.25, 'sine', 0.05, 260),
  mist: () => noise(0, 0.35, 0.25, 3200),
  turn: () => tone(330, 0, 0.25, 'triangle', 0.1, 520),
  sing: () => [523, 659, 784, 659, 880].forEach((f, i) => tone(f, i * 0.14, 0.18, 'sine', 0.1)),
  nope: () => tone(260, 0, 0.15, 'square', 0.04, 200),
  toggle: () => tone(440, 0, 0.06, 'square', 0.04),
  crack: () => {
    noise(0, 0.08, 0.5, 1800);
    tone(900, 0, 0.05, 'square', 0.04, 500);
  },
  hatch: () => {
    noise(0, 0.25, 0.6, 1400);
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.15 + i * 0.09, 0.3, 'triangle', 0.12));
  },
};
