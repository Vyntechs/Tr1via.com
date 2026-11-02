// Review 2 fixes: invisible / direction-trick characters are stripped by the
// one shared cleanup (phone and server), and edits over the cap keep what
// was already typed and cut only the inserted text, like a native maxLength.

import { describe, expect, it } from "vitest";
import { CreatePlayerSchema, HostAddPlayerSchema } from "@/lib/api/schemas";
import {
  cleanPlayerName,
  countNameChars,
  fitNameEdit,
  hasVisibleChar,
} from "@/lib/player/nameLimit";

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const join = (displayName: string) => CreatePlayerSchema.safeParse({ nightId: NIGHT_ID, displayName });

describe("cleanPlayerName: invisible and direction-trick characters", () => {
  it("removes zero-width spaces, word joiners, BOM, soft hyphens and controls", () => {
    expect(cleanPlayerName("Ma\u200Bya\u2060\uFEFF\u00AD\t")).toBe("Maya");
  });

  it("removes Hangul fillers and the blank Braille cell", () => {
    expect(cleanPlayerName("\u3164Bo\u115F\u1160b\uFFA0\u2800")).toBe("Bob");
  });

  it("removes every direction override, embedding, isolate and mark", () => {
    const tricks = "\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F\u061C";
    expect(cleanPlayerName(`${tricks}evil name${tricks}`)).toBe("evil name");
    expect(cleanPlayerName("\u202Eeman live")).toBe("eman live");
  });

  it("keeps the joiner inside family, profession, flag and skin-tone emoji", () => {
    for (const e of ["👨\u200D👩\u200D👧", "🧑🏽\u200D🚀", "🏳️\u200D🌈", "👁️\u200D🗨️", "👩🏿\u200D❤️\u200D👨🏻", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "🇺🇸"]) {
      expect(cleanPlayerName(e)).toBe(e);
      expect(countNameChars(cleanPlayerName(e))).toBe(1);
    }
  });

  it("keeps joiners between letters of scripts that use them, drops stray ones", () => {
    expect(cleanPlayerName("ශ්\u200Dරී")).toBe("ශ්\u200Dරී"); // Sinhala
    expect(cleanPlayerName("می\u200Cخواهم")).toBe("می\u200Cخواهم"); // Persian non-joiner
    expect(cleanPlayerName("\u200DSam\u200D")).toBe("Sam");
    expect(cleanPlayerName("Sam \u200C\u200D 😀")).toBe("Sam  😀");
    expect(cleanPlayerName("a\u200D😀")).toBe("a😀");
    expect(cleanPlayerName("😀\u200Da")).toBe("😀a");
  });

  it("leaves ordinary names and accents alone", () => {
    for (const n of ["Maya", "José", "Nguyện", "Zoë O'Neil", "李小龍", "Sam 👍🏽"]) expect(cleanPlayerName(n)).toBe(n);
  });

  it("needs at least one visible character", () => {
    expect(hasVisibleChar(cleanPlayerName("\u200B".repeat(16)))).toBe(false);
    expect(hasVisibleChar(cleanPlayerName("\u3164\u3164"))).toBe(false);
    expect(hasVisibleChar("́́")).toBe(false);
    expect(hasVisibleChar("😀")).toBe(true);
    expect(hasVisibleChar("7")).toBe(true);
  });
});

describe("server uses the same cleanup", () => {
  it("rejects an invisible-only name with the friendly error", () => {
    for (const n of ["\u200B".repeat(16), "\u3164", "\u115F\u1160", "\u202E", "\uFEFF\u2800", "́"]) {
      const r = join(n);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Pick a name to join.");
      expect(HostAddPlayerSchema.safeParse({ displayName: n }).success).toBe(false);
    }
  });

  it("strips a right-to-left override before saving", () => {
    const r = join("\u202Eevil name");
    expect(r.success && r.data.displayName).toBe("evil name");
  });

  it("does not count stripped invisibles toward 16", () => {
    const r = join("A".repeat(16) + "\u200B".repeat(10));
    expect(r.success && r.data.displayName).toBe("A".repeat(16));
  });

  it("cleaning twice gives the same name (phone result always passes the server)", () => {
    for (const n of ["\u200Da\u200D😀\u200D", " \u202Ex \u200B", "ශ්\u200Dරී ලංකා", "👨\u200D👩\u200D👧 Crew\u200D"]) {
      const once = cleanPlayerName(n).trim();
      expect(cleanPlayerName(once).trim()).toBe(once);
    }
  });
});

describe("fitNameEdit: over the cap, cut only the inserted text", () => {
  const FULL = "abcdefghijklmnop"; // 16

  it("select-all + paste over a full name pastes as much as fits", () => {
    expect(fitNameEdit(FULL, "Christopher Columbus", 20)).toEqual({ value: "Christopher Colu", caret: 16 });
  });

  it("paste over part of a full name keeps the rest", () => {
    // "abc" selected, "XYZW" pasted.
    expect(fitNameEdit(FULL, "XYZWdefghijklmnop", 4)).toEqual({ value: "XYZdefghijklmnop", caret: 3 });
  });

  it("paste in the middle never chops the end of what was typed", () => {
    expect(fitNameEdit("Bob the Builder", "Captain Bob the Builder", 8)).toEqual({ value: "CBob the Builder", caret: 1 });
    expect(fitNameEdit("Bob Builder", "Bob the great Builder", 14)).toEqual({ value: "Bob the gBuilder", caret: 9 });
  });

  it("a keystroke in a full box changes nothing and keeps the cursor where it was", () => {
    expect(fitNameEdit("Jennifer Thompso", "Jenniferr Thompso", 9)).toEqual({ value: "Jennifer Thompso", caret: 8 });
  });

  it("an autocorrect that swaps a word for a longer one inserts what fits", () => {
    // "teh" replaced by "the very" at the end of a 15-character box.
    expect(fitNameEdit("Pizza Party teh", "Pizza Party the very", 20).value).toBe("Pizza Party the ");
  });

  it("never splits an emoji when replacing one with another", () => {
    const prev = "abcdefghijklmno😀";
    expect(fitNameEdit(prev, "abcdefghijklmno😃", 17).value).toBe("abcdefghijklmno😃");
    expect(fitNameEdit(prev, "abcdefghijklmno😃🍕", 19).value).toBe("abcdefghijklmno😃");
  });

  it("allows a skin tone added to an emoji in a full box", () => {
    expect(fitNameEdit("abcdefghijklmno👍", "abcdefghijklmno👍🏽", 19).value).toBe("abcdefghijklmno👍🏽");
  });

  it("works without a cursor position", () => {
    expect(fitNameEdit("", "Christopher Smith Jr").value).toBe("Christopher Smit");
    expect(fitNameEdit("Jennifer Thompso", "Jenniferr Thompso").value).toBe("Jennifer Thompso");
  });
});

describe("review 3: the invisible-character strip list", () => {
  // Written as code points on purpose: if an editor or copy-paste ever drops
  // a raw zero-width character from nameLimit.ts, one of these fails.
  const EXPECTED: number[] = [
    0x00ad, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x200b, 0x200e, 0x200f,
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2800, 0x3164, 0xfeff, 0xffa0,
    ...Array.from({ length: 0x206f - 0x2060 + 1 }, (_, i) => 0x2060 + i),
    0x0000, 0x0009, 0x000a, 0x001f, 0x007f, 0x009f,
  ];

  it.each(EXPECTED.map((cp) => [cp.toString(16).toUpperCase().padStart(4, "0"), cp]))(
    "strips U+%s",
    (_label, cp) => {
      expect(cleanPlayerName(`a${String.fromCodePoint(cp as number)}b`)).toBe("ab");
    },
  );

  it("drops stray zero-width joiners but keeps them inside an emoji", () => {
    // Not between two letters and not inside an emoji: dropped.
    expect(cleanPlayerName("\u200Ca 1\u200D")).toBe("a 1");
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(cleanPlayerName(family)).toBe(family);
  });

  it("nameLimit.ts has no raw invisible or direction characters in its source", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "lib/player/nameLimit.ts"), "utf8");
    expect(src).not.toMatch(/[\u00AD\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]/u);
  });
});
