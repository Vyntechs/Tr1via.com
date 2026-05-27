// Unit tests for lib/audio/welcomeChime.ts. The chime module must:
//   1. Be safe to import on the server (no top-level browser API calls).
//   2. Be a no-op when AudioContext is unavailable (jsdom is one such env).
//   3. Lazy-create the AudioContext on first playWelcomeChime() — not on
//      module load — so iOS Safari respects the user-gesture rule.
//   4. Reuse the AudioContext across calls.
//
// In jsdom, AudioContext isn't defined by default; we assert the
// no-op + reset-for-tests path. With a polyfill installed we'd cover
// the reuse path too, but the no-op path is the critical one for SSR
// safety and we don't want to ship a Web Audio polyfill just for the
// tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetWelcomeChimeForTests,
  playWelcomeChime,
  triggerWelcomeHaptic,
} from "@/lib/audio/welcomeChime";

afterEach(() => {
  __resetWelcomeChimeForTests();
  // Clean up any AudioContext we attached on the window.
  if (typeof window !== "undefined") {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  }
});

// Skipped 2026-05-27: Brandon disabled all sound effects across the app.
// playWelcomeChime is now an early-return no-op (see lib/audio/welcomeChime.ts).
// If sound ever comes back, change `describe.skip` → `describe` here AND
// remove the `return;` at the top of playWelcomeChime to revive both.
describe.skip("playWelcomeChime", () => {
  it("does not throw when AudioContext is missing", () => {
    // Ensure no AudioContext exists on the window.
    expect(() => playWelcomeChime()).not.toThrow();
  });

  it("lazily creates the AudioContext only on first call", () => {
    const ctorSpy = vi.fn().mockImplementation(() => ({
      currentTime: 0,
      state: "running",
      destination: {} as unknown,
      resume: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      })),
    }));
    (window as unknown as { AudioContext: unknown }).AudioContext = ctorSpy;

    // Module-load alone should NOT construct the context.
    expect(ctorSpy).not.toHaveBeenCalled();

    playWelcomeChime();
    expect(ctorSpy).toHaveBeenCalledTimes(1);

    // Second call reuses the same context — not re-constructed.
    playWelcomeChime();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back silently when AudioContext construction throws", () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = function ThrowingCtx() {
      throw new Error("denied");
    };
    expect(() => playWelcomeChime()).not.toThrow();
    // Subsequent calls also no-op (sticky failure flag).
    expect(() => playWelcomeChime()).not.toThrow();
  });
});

describe("triggerWelcomeHaptic", () => {
  it("returns false when navigator.vibrate is absent", () => {
    // jsdom does not implement navigator.vibrate.
    expect(triggerWelcomeHaptic()).toBe(false);
  });

  it("invokes navigator.vibrate when available", () => {
    const vibrate = vi.fn().mockReturnValue(true);
    (navigator as unknown as { vibrate: typeof vibrate }).vibrate = vibrate;
    try {
      const result = triggerWelcomeHaptic();
      expect(result).toBe(true);
      expect(vibrate).toHaveBeenCalledWith([12, 40, 18]);
    } finally {
      delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    }
  });
});
