// Procedural thunder synthesizer via Web Audio API.
//
// No audio file shipped — we synthesize each thunder clap from scratch.
// This keeps the bundle tiny (the first host's bar is on slow venue Wi-Fi) and
// gives every strike a slightly different roll.
//
// Two flavors:
//   • `distant` — slow attack, long roll, deep sub-bass; -800-2000ms delay
//                  after the flash to sell distance (sound is slow).
//   • `close`   — sharp transient at the front (the crack), shorter roll;
//                  100-300ms delay after the flash.
//
// One AudioContext per page. iOS Safari requires the first interaction to
// resume() it — we lazy-init on first call and silently fail if the user
// hasn't tapped anything yet (the visual still fires).
//
// Volume: master gain at -6dB below 0dBFS so it doesn't peak in noisy bars.

const MASTER_GAIN = 0.5; // -6dB-ish

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

export interface ThunderOptions {
  distance: "distant" | "close";
  /** Delay before the audio fires (after the visible flash), in ms.
   *  Pass null for the default range per distance. */
  delayMs?: number;
  /** Optional volume multiplier (0..1). Stacks on top of master. */
  volume?: number;
  /** Override the synth seed for testing. */
  seed?: number;
}

/**
 * Lazy-init the audio context. Safe to call repeatedly.
 * Returns null if Web Audio is unavailable (SSR or very old browser).
 */
export function getThunderContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  type AudioContextCtor = typeof AudioContext;
  type WindowWithWebkitAudio = Window & {
    webkitAudioContext?: AudioContextCtor;
  };
  const AC =
    (window.AudioContext as AudioContextCtor | undefined) ??
    (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(ctx.destination);
  } catch {
    return null;
  }
  return ctx;
}

/** Mute / unmute all thunder. Used by the dev page. */
export function setThunderMuted(value: boolean): void {
  muted = value;
  if (masterGain) {
    masterGain.gain.value = value ? 0 : MASTER_GAIN;
  }
}

export function isThunderMuted(): boolean {
  return muted;
}

/**
 * Resume the AudioContext if it was created in a non-interactive context
 * (iOS suspends until user gesture). Call from a click handler ideally.
 */
export async function unlockThunder(): Promise<void> {
  const c = getThunderContext();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      // Browser declined — caller can retry on next user gesture.
    }
  }
}

// Kill switch: when true, playThunder is a no-op. Brandon's call
// (2026-05-27) — no sound from any surface. May/Storm Lightning still
// fires visually (it calls playThunder for the audio half of the
// strike); the audio half is silenced here. Set to false to revive.
// Typed as `boolean` (not literal `true`) so TypeScript still flow-
// analyzes the implementation below as reachable.
const SOUNDS_DISABLED: boolean = true;

/**
 * Fire one thunder clap — gated by SOUNDS_DISABLED. When the kill
 * switch is true the function returns null immediately; when false it
 * schedules the original sound graph (preserved for future revert).
 */
export function playThunder(options: ThunderOptions): number | null {
  if (SOUNDS_DISABLED) return null;
  const c = getThunderContext();
  if (!c || !masterGain) return null;

  // iOS: if the context is still suspended (no user gesture yet), bail
  // silently. The visual still played, the audio just won't.
  if (c.state === "suspended") {
    // Try to resume in the background — next call might succeed.
    void c.resume();
    return null;
  }

  const { distance, delayMs, volume = 1, seed = Date.now() } = options;

  // Default delays per distance.
  const defaultDelayMs = distance === "distant" ? 800 + Math.random() * 1200 : 100 + Math.random() * 200;
  const dMs = delayMs ?? defaultDelayMs;
  const startTime = c.currentTime + dMs / 1000;

  // Distance-specific envelope timings (all seconds).
  const env = distance === "distant"
    ? { attack: 0.22, sustain: 0.9, decay: 1.4, peakLevel: 0.7 * volume }
    : { attack: 0.04, sustain: 0.7, decay: 0.9, peakLevel: 1.0 * volume };

  // ── Graph ──
  // Buffer-source (white noise) → lowpass (40-200Hz) → noise gain
  // OscNode (sub-bass ~60Hz)    → osc gain
  // Both → bus gain → master.
  const total = env.attack + env.sustain + env.decay;
  const noiseBuf = makeNoiseBuffer(c, total + 0.2, seed);

  const noiseSrc = c.createBufferSource();
  noiseSrc.buffer = noiseBuf;

  const lowpass = c.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = distance === "distant" ? 180 : 240;
  lowpass.Q.value = 0.7;

  const highpass = c.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 35;
  highpass.Q.value = 0.5;

  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0, startTime);

  // Sub-bass oscillator — pitch-bends slightly downward, suggesting energy
  // dissipating.
  const sub = c.createOscillator();
  sub.type = "sine";
  const subStartFreq = distance === "distant" ? 55 : 75;
  const subEndFreq = distance === "distant" ? 35 : 50;
  sub.frequency.setValueAtTime(subStartFreq, startTime);
  sub.frequency.linearRampToValueAtTime(subEndFreq, startTime + total);
  const subGain = c.createGain();
  subGain.gain.setValueAtTime(0, startTime);

  // Close strikes get a sharp transient at the front (the crack). It's a
  // brief band-limited noise pop, mixed in alongside the main roll.
  if (distance === "close") {
    const crackBuf = makeNoiseBuffer(c, 0.08, seed + 1);
    const crackSrc = c.createBufferSource();
    crackSrc.buffer = crackBuf;
    const crackFilter = c.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 380;
    crackFilter.Q.value = 1.4;
    const crackGain = c.createGain();
    crackGain.gain.setValueAtTime(0, startTime);
    crackGain.gain.linearRampToValueAtTime(0.85 * volume, startTime + 0.005);
    crackGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);
    crackSrc.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(masterGain);
    crackSrc.start(startTime);
    crackSrc.stop(startTime + 0.1);
  }

  // Noise envelope.
  noiseGain.gain.linearRampToValueAtTime(env.peakLevel, startTime + env.attack);
  noiseGain.gain.setValueAtTime(env.peakLevel, startTime + env.attack + env.sustain * 0.4);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + total);

  // Sub-bass envelope — peaks slightly after the noise to imply rolling.
  subGain.gain.linearRampToValueAtTime(env.peakLevel * 0.5, startTime + env.attack * 1.2);
  subGain.gain.exponentialRampToValueAtTime(0.001, startTime + total);

  // Wire it up.
  noiseSrc.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(noiseGain);
  noiseGain.connect(masterGain);
  sub.connect(subGain);
  subGain.connect(masterGain);

  noiseSrc.start(startTime);
  noiseSrc.stop(startTime + total + 0.1);
  sub.start(startTime);
  sub.stop(startTime + total + 0.1);

  return startTime;
}

/** Synthesize a deterministic noise buffer. Length in seconds. */
function makeNoiseBuffer(c: AudioContext, durationS: number, seed: number): AudioBuffer {
  const sr = c.sampleRate;
  const length = Math.max(1, Math.floor(durationS * sr));
  const buf = c.createBuffer(1, length, sr);
  const data = buf.getChannelData(0);
  // Simple LCG so seed actually does something (and tests can verify
  // determinism). Quality is fine for thunder — it's noise.
  let s = (seed | 0) >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    // Map to [-1, 1].
    data[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}
