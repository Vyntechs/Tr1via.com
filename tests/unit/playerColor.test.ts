// Unit tests for lib/player/playerColor.ts — the per-player Magic-Welcome
// color helper. The hash MUST be deterministic across processes (server +
// client) so the broadcast payload's colorKey matches what receivers
// compute locally as a fallback.

import { describe, it, expect } from "vitest";
import {
  PLAYER_PALETTE,
  colorHexFromKey,
  playerColorHex,
  playerColorKey,
} from "@/lib/player/playerColor";

describe("playerColorKey", () => {
  it("is deterministic", () => {
    const id = "abc-123-def";
    const a = playerColorKey(id);
    const b = playerColorKey(id);
    expect(a).toBe(b);
  });

  it("returns a key inside the palette range", () => {
    const ids = ["x", "p_001", "this-is-a-uuid-shape-string-1234-abc"];
    for (const id of ids) {
      const key = playerColorKey(id);
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThan(PLAYER_PALETTE.length);
    }
  });

  it("handles empty input without throwing", () => {
    expect(() => playerColorKey("")).not.toThrow();
    expect(playerColorKey("")).toBe(0);
  });

  it("distributes across the palette (no single id sinks)", () => {
    // Generate 200 pseudo-random ids and assert at least 6 distinct keys
    // are produced. FNV-1a should easily distribute that broadly.
    const buckets = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      buckets.add(playerColorKey(`player-${i}-${i * 31}`));
    }
    expect(buckets.size).toBeGreaterThanOrEqual(6);
  });
});

describe("playerColorHex", () => {
  it("maps to a 6-digit hex from the palette", () => {
    const hex = playerColorHex("any-id");
    expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(PLAYER_PALETTE).toContain(hex);
  });

  it("matches what colorHexFromKey returns for the same id", () => {
    const id = "abc";
    expect(playerColorHex(id)).toBe(colorHexFromKey(playerColorKey(id)));
  });
});

describe("colorHexFromKey", () => {
  it("returns palette[0] for negative or invalid keys", () => {
    expect(colorHexFromKey(-1)).toBe(PLAYER_PALETTE[0]);
    expect(colorHexFromKey(Number.NaN)).toBe(PLAYER_PALETTE[0]);
  });

  it("wraps keys larger than the palette length", () => {
    const beyond = PLAYER_PALETTE.length + 3;
    expect(colorHexFromKey(beyond)).toBe(PLAYER_PALETTE[3]);
  });
});
