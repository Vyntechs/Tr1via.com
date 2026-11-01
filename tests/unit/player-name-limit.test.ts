// Player names cap at 16 characters, counted the way people see them.
// Long names were getting cut off with "…" on the TV.

import { describe, expect, it } from "vitest";
import {
  CreatePlayerSchema,
  HostAddPlayerSchema,
} from "@/lib/api/schemas";
import {
  MAX_PLAYER_NAME,
  PLAYER_NAME_TOO_LONG_MESSAGE,
  clampPlayerName,
  countNameChars,
} from "@/lib/player/nameLimit";

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const join = (displayName: string) => CreatePlayerSchema.safeParse({ nightId: NIGHT_ID, displayName });

describe("player name limit (16 visible characters)", () => {
  it("is 16", () => {
    expect(MAX_PLAYER_NAME).toBe(16);
  });

  it("accepts exactly 16 characters", () => {
    expect(join("A".repeat(16)).success).toBe(true);
    expect(HostAddPlayerSchema.safeParse({ displayName: "B".repeat(16) }).success).toBe(true);
  });

  it("rejects 17 characters with a clear message", () => {
    const res = join("A".repeat(17));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toBe(PLAYER_NAME_TOO_LONG_MESSAGE);
    expect(HostAddPlayerSchema.safeParse({ displayName: "B".repeat(17) }).success).toBe(false);
  });

  it("counts an emoji as one character, even multi-part ones", () => {
    expect(countNameChars("🍕")).toBe(1);
    expect(countNameChars("👨‍👩‍👧")).toBe(1); // family (joined with ZWJ)
    expect(countNameChars("🇺🇸")).toBe(1); // flag
    expect(countNameChars("José")).toBe(4);
    // 15 letters + 1 emoji = 16 → ok, even though it is 17+ UTF-16 units.
    const name = "Pizza Party Pal🍕";
    expect(name.length).toBeGreaterThan(16);
    expect(join(name).success).toBe(true);
    expect(join("Pizza Party Pal👨‍👩‍👧").success).toBe(true);
    expect(join("Pizza Party Pals🍕").success).toBe(false);
  });

  it("trims whitespace before counting", () => {
    const res = join(`   ${"A".repeat(16)}   `);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.displayName).toBe("A".repeat(16));
  });

  it("still rejects an empty or blank name", () => {
    expect(join("").success).toBe(false);
    expect(join("    ").success).toBe(false);
  });

  it("clampPlayerName keeps 16 characters and never splits an emoji", () => {
    expect(clampPlayerName("A".repeat(40))).toBe("A".repeat(16));
    expect(clampPlayerName("Maya")).toBe("Maya");
    const clamped = clampPlayerName("A".repeat(15) + "👨‍👩‍👧" + "BBB");
    expect(clamped).toBe("A".repeat(15) + "👨‍👩‍👧");
    expect(countNameChars(clamped)).toBe(16);
  });
});
