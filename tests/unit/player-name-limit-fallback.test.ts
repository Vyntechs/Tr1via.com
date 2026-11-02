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

  it("never counts a zero-width joiner between letters as one character (review 2)", () => {
    for (const s of ["a‍b‍c‍d", "ශ්‍රී ලංකා", "x".repeat(15) + "‍" + "y".repeat(10), "a‍😀", "😀‍a"]) {
      expect(fb.countNameChars(s)).toBeGreaterThanOrEqual(full.countNameChars(s));
    }
    expect(fb.countNameChars("a‍b‍c‍d")).toBe(4);
  });

  it("is never looser than the server on thousands of generated names", () => {
    // Small seeded generator so the run is repeatable (no extra library).
    let seed = 0x5eed1234;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const pool = [
      "a", "Z", "7", " ", "é", "́", "̣", "̂", // letters, combining marks
      "ि", "्", "क", "ष", "ါ", "က", // Hindi spacing mark + virama, Myanmar mark
      "‍", "‌", "️", "︎", "⃣", // joiners, variation selectors, keycap
      "😀", "👨", "👩", "👧", "🚀", "❤", "🏳", "🌈", "👍", "🧑", // emoji
      "\u{1F3FB}", "\u{1F3FD}", "\u{1F3FF}", // skin tones
      "\u{1F1FA}", "\u{1F1F8}", "\u{1F1EC}", // flag letters
      "\u{E0067}", "\u{E0062}", "\u{E007F}", // tag characters
      "ᄀ", "ᅡ", "ᆨ", "한", // Hangul letter parts
      "\u0007", "­", "\r", "\n", "؀", "​", "‮", "ㅤ", // controls, format, invisibles
      "李", "ශ", "්", "ර",
      "\u2065", "\uFFF0", "\u{E0000}", "\u{E0080}", "\u2028", // unassigned / separators the server never joins onto
    ];
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const len = 1 + rand(24);
      let s = "";
      for (let j = 0; j < len; j++) s += pool[rand(pool.length)];
      const fbCount = fb.countNameChars(s);
      const serverCount = full.countNameChars(s);
      if (fbCount < serverCount) throw new Error(`fallback ${fbCount} < server ${serverCount} for ${JSON.stringify(s)}`);
      const cleaned = fb.cleanPlayerName(s);
      expect(fb.countNameChars(cleaned)).toBeGreaterThanOrEqual(full.countNameChars(cleaned));
      // Whatever the old phone's box would hold passes the server.
      const c = fb.clampPlayerName(s).trim();
      expect(full.playerNameFits(full.cleanPlayerName(c).trim())).toBe(true);
      checked++;
    }
    expect(checked).toBe(4000);
  });
});

