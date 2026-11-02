// Phones without Intl.Segmenter (iOS 14.4 and older, Firefox before 125)
// count names with a simpler fallback. It must never be looser than the
// server (which always has Segmenter) and must keep the 16 cap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type NameLimit = typeof import("@/lib/player/nameLimit");

const realSegmenter = (Intl as unknown as { Segmenter?: unknown }).Segmenter;

async function loadWithoutSegmenter(): Promise<NameLimit> {
  vi.resetModules();
  Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true, writable: true });
  return import("@/lib/player/nameLimit");
}

async function loadWithSegmenter(): Promise<NameLimit> {
  vi.resetModules();
  Object.defineProperty(Intl, "Segmenter", { value: realSegmenter, configurable: true, writable: true });
  return import("@/lib/player/nameLimit");
}

describe("name limit without Intl.Segmenter", () => {
  let fb: NameLimit;
  let full: NameLimit;

  beforeEach(async () => {
    full = await loadWithSegmenter();
    fb = await loadWithoutSegmenter();
  });

  afterEach(() => {
    Object.defineProperty(Intl, "Segmenter", { value: realSegmenter, configurable: true, writable: true });
    vi.resetModules();
  });

  it("really is running the fallback", () => {
    expect((Intl as unknown as { Segmenter?: unknown }).Segmenter).toBeUndefined();
  });

  const samples = [
    "Maya",
    "José",
    "José",
    "Nguyện",
    "Sam 👍🏽",
    "🇺🇸🇬🇧",
    "👨‍👩‍👧 Crew",
    "🏳️‍🌈",
    "Room 1️⃣",
    "A".repeat(15) + "🇺🇸",
    "abcdefghijklmno👍🏽xyz",
    "A" + "́".repeat(50) + "bc",
  ];

  it("counts common names and emoji the same as the full counter", () => {
    for (const s of samples) expect(fb.countNameChars(s)).toBe(full.countNameChars(s));
  });

  it("is never looser than the server, and the clamp stays within 16", () => {
    for (const s of samples) {
      expect(fb.countNameChars(s)).toBeGreaterThanOrEqual(full.countNameChars(s));
      const c = fb.clampPlayerName(s + "XXXXXXXXXXXXXXXXXX");
      expect(full.countNameChars(c)).toBeLessThanOrEqual(16);
      expect(full.playerNameFits(c)).toBe(true);
    }
  });

  it("keeps a flag or skin tone whole at the cut", () => {
    expect(fb.clampPlayerName("abcdefghijklmno🇺🇸")).toBe("abcdefghijklmno🇺🇸");
    expect(fb.clampPlayerName("abcdefghijklmno🇺🇸Z")).toBe("abcdefghijklmno🇺🇸");
    expect(fb.clampPlayerName("abcdefghijklmno👍🏽Z")).toBe("abcdefghijklmno👍🏽");
  });
});
