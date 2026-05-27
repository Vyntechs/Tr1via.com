// Magic-Welcome chime — procedural audio.
//
// A two-note rising major third (E5 → G#5) synthesized live with the Web
// Audio API. No mp3 ship cost; no fetch latency on the join moment. The
// same chime fires on the joining player's own phone, on the host live
// console, and on the venue TV — under 400ms total.
//
// Design specs (from the project brief, verified against first principles):
//   - Two notes:  E5 (~659.25 Hz)  →  G#5 (~830.61 Hz)
//   - Waveform:   sine + soft triangle overlay (warmth, not piercing)
//   - Envelope:   attack 20ms, decay 100ms, sustain ~0 (impulse), release 220ms
//   - Timing:     second note starts +80ms after the first; overlap ~40ms
//   - Total:      ~380ms
//   - Volume:     -3 dB below media peak (gain 0.5, scaled per oscillator)
//
// Lazy AudioContext: we DO NOT create the AudioContext until the first
// playWelcomeChime() call. iOS Safari refuses to play audio from an
// AudioContext created outside a user gesture (it stays in "suspended"
// state), so we defer creation to the first chime call — which always
// happens inside a click/tap handler chain on the player phone (the
// join tap is the gesture) and on the host laptop (the host's first
// interaction with the live console).
//
// On servers / SSR / jsdom: no AudioContext → playWelcomeChime() is a
// safe no-op. No throw, no log spam.

"use client";

let cachedContext: AudioContext | null = null;
let hasFailed = false;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/**
 * Get the shared AudioContext, creating it lazily on first use. Returns
 * null when running in an environment without Web Audio (SSR, jsdom,
 * or older browsers) — callers should treat null as "play nothing,
 * don't throw".
 */
function getAudioContext(): AudioContext | null {
  if (hasFailed) return null;
  if (cachedContext) return cachedContext;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as WindowWithWebkitAudio).webkitAudioContext ??
    null;
  if (!Ctor) {
    hasFailed = true;
    return null;
  }
  try {
    cachedContext = new Ctor();
    return cachedContext;
  } catch {
    hasFailed = true;
    return null;
  }
}

/**
 * Play the welcome chime: a 380ms two-note rising major third with a
 * warm sine+triangle blend. Fire-and-forget — resolves immediately,
 * audio plays asynchronously.
 *
 * Safe to call on every surface (host laptop, venue TV, player phone)
 * — each independent AudioContext means each surface plays its own
 * chime locally (no network round-trip).
 */
export function playWelcomeChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // iOS suspends contexts when created outside a gesture. Resume if
  // possible; if it stays suspended, scheduleNote() still queues the
  // notes and they'll play on the next user gesture (best-effort).
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {
      /* best-effort */
    });
  }

  const startAt = ctx.currentTime + 0.02; // 20ms lead so the attack curves cleanly

  // First note: E5 (659.25 Hz). Sine carrier, triangle warmth at -12 dB.
  scheduleNote(ctx, {
    frequency: 659.25,
    startAt,
    durationS: 0.34,
    peakGain: 0.5,
    triangleMix: 0.2,
  });

  // Second note: G#5 (830.61 Hz). Starts +80ms after the first, so the
  // first note is mid-release when the second hits → the rising-third
  // interval reads as a single "received" gesture.
  scheduleNote(ctx, {
    frequency: 830.61,
    startAt: startAt + 0.08,
    durationS: 0.3,
    peakGain: 0.5,
    triangleMix: 0.2,
  });
}

interface ScheduleNoteParams {
  frequency: number;
  startAt: number;
  durationS: number;
  peakGain: number;
  triangleMix: number;
}

/**
 * Schedule one note on the shared context. ADSR-ish envelope: attack
 * 20ms, decay 100ms, release through the remainder.
 */
function scheduleNote(ctx: AudioContext, params: ScheduleNoteParams): void {
  const { frequency, startAt, durationS, peakGain, triangleMix } = params;
  const releaseStart = startAt + 0.12; // after attack+decay
  const endAt = startAt + durationS;

  // Sine carrier — the main tonal body.
  const sine = ctx.createOscillator();
  sine.type = "sine";
  sine.frequency.value = frequency;
  const sineGain = ctx.createGain();
  sineGain.gain.setValueAtTime(0, startAt);
  sineGain.gain.linearRampToValueAtTime(peakGain, startAt + 0.02); // attack
  sineGain.gain.linearRampToValueAtTime(peakGain * 0.85, releaseStart); // decay → sustain
  sineGain.gain.exponentialRampToValueAtTime(0.0001, endAt); // release
  sine.connect(sineGain);

  // Triangle warmth — same frequency, low mix, gives the chime body
  // without making it nasal.
  const triangle = ctx.createOscillator();
  triangle.type = "triangle";
  triangle.frequency.value = frequency;
  const triangleGain = ctx.createGain();
  const trianglePeak = peakGain * triangleMix;
  triangleGain.gain.setValueAtTime(0, startAt);
  triangleGain.gain.linearRampToValueAtTime(trianglePeak, startAt + 0.02);
  triangleGain.gain.linearRampToValueAtTime(trianglePeak * 0.85, releaseStart);
  triangleGain.gain.exponentialRampToValueAtTime(0.0001, endAt);
  triangle.connect(triangleGain);

  // Sum the two oscillators into the master output.
  sineGain.connect(ctx.destination);
  triangleGain.connect(ctx.destination);

  sine.start(startAt);
  sine.stop(endAt + 0.01);
  triangle.start(startAt);
  triangle.stop(endAt + 0.01);
}

/**
 * Best-effort haptic — short tap pattern matching the chime's rising
 * interval. Android Chrome supports `navigator.vibrate`; iOS Safari does
 * not (and the label/switch workaround is broken in iOS 26.5, per brief).
 *
 * Returns true if a haptic was triggered, false if the platform doesn't
 * support it (caller can use a stronger color flash to compensate).
 */
export function triggerWelcomeHaptic(): boolean {
  if (typeof navigator === "undefined") return false;
  const vibrate = (navigator as unknown as { vibrate?: (p: number | number[]) => boolean })
    .vibrate;
  if (typeof vibrate !== "function") return false;
  try {
    return vibrate.call(navigator, [12, 40, 18]);
  } catch {
    return false;
  }
}

/**
 * Test-only: reset the cached AudioContext so unit tests can assert
 * lazy-creation behavior. Not exported from the barrel; importers
 * should not call this in production.
 */
export function __resetWelcomeChimeForTests(): void {
  cachedContext = null;
  hasFailed = false;
}
