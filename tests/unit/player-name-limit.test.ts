// Player names cap at 16 characters, counted the way people see them.
// Long names were getting cut off with "…" on the TV.

import { describe, expect, it } from "vitest";
import {
  CreatePlayerSchema,
  HostAddPlayerSchema,
} from "@/lib/api/schemas";
import {
  MAX_PLAYER_NAME,
  MAX_PLAYER_NAME_RAW,
  MAX_STACKED_MARKS,
  PLAYER_NAME_TOO_LONG_MESSAGE,
  applyNameEdit,
  clampPlayerName,
  countNameChars,
  stripExcessMarks,
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

describe("stacked accent marks (\"glitch text\")", () => {
  const ACUTE = "́";

  it("keeps at most 3 marks on one character, phone and server alike", () => {
    expect(MAX_STACKED_MARKS).toBe(3);
    const glitch = "A" + ACUTE.repeat(180) + "bc";
    expect(stripExcessMarks(glitch)).toBe("A" + ACUTE.repeat(3) + "bc");
    expect(clampPlayerName(glitch)).toBe("A" + ACUTE.repeat(3) + "bc");
    const res = join(glitch);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.displayName).toBe("A" + ACUTE.repeat(3) + "bc");
  });

  it("leaves real accented names and emoji untouched", () => {
    const real = [
      "José", // precomposed
      "José", // e + accent mark
      "Nguyện", // Vietnamese ệ typed as e + 2 marks
      "Nguyễn",
      "Peña",
      "ज़ीं", // Hindi: nukta + vowel sign + nasal mark (3 marks)
      "Sam 👍🏽",
      "🇺🇸 Team",
      "👨‍👩‍👧 Crew",
      "🏳️‍🌈",
      "Room 1️⃣", // keycap: FE0F + U+20E3, 2 marks
      "👩🏽‍❤️‍💋‍👨🏻",
    ];
    for (const name of real) {
      expect(stripExcessMarks(name)).toBe(name);
      expect(clampPlayerName(name)).toBe(name);
      expect(join(name).success).toBe(true);
    }
  });

  it("raw ceiling is back near the old 40 and covers every old-page name", () => {
    expect(MAX_PLAYER_NAME_RAW).toBe(64);
    expect(MAX_PLAYER_NAME_RAW).toBeGreaterThanOrEqual(40);
    // 16 letters with 3 marks each = 64 units, still fits.
    const heavy = ("e" + "̣̂́").repeat(16);
    expect(heavy.length).toBe(64);
    expect(join(heavy).success).toBe(true);
    // Junk over the ceiling is refused by the strict schema...
    const fam = "👨‍👩‍👧‍👦"; // 11 units
    expect(join(fam.repeat(7)).success).toBe(false);
    // ...and the phone's clamp cuts at a whole character under the ceiling.
    const clamped = clampPlayerName(fam.repeat(7));
    expect(clamped).toBe(fam.repeat(5));
    expect(HostAddPlayerSchema.safeParse({ displayName: clamped }).success).toBe(true);
  });
});

describe("applyNameEdit (typing into a full box)", () => {
  const FULL = "Jennifer Thompso"; // 16

  it("ignores a keystroke in the middle of a full name instead of dropping the last letter", () => {
    expect(applyNameEdit(FULL, "Jenniferr Thompso")).toBe(FULL);
  });

  it("still cuts a long paste to 16 when the box was not full", () => {
    expect(applyNameEdit("", "Christopher Smith Jr")).toBe("Christopher Smit");
    expect(applyNameEdit("Chris", "Christopher Smith Jr")).toBe("Christopher Smit");
  });

  it("allows normal typing and deleting", () => {
    expect(applyNameEdit("Jen", "Jenn")).toBe("Jenn");
    expect(applyNameEdit(FULL, "Jennifer Thomps")).toBe("Jennifer Thomps");
  });
});
