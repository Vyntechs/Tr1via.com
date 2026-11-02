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
    expect(cleanPlayerName("Ma​ya⁠﻿­\t")).toBe("Maya");
  });

  it("removes Hangul fillers and the blank Braille cell", () => {
    expect(cleanPlayerName("ㅤBoᅟᅠbﾠ⠀")).toBe("Bob");
  });

  it("removes every direction override, embedding, isolate and mark", () => {
    const tricks = "‪‫‬‭‮⁦⁧⁨⁩‎‏؜";
    expect(cleanPlayerName(`${tricks}evil name${tricks}`)).toBe("evil name");
    expect(cleanPlayerName("‮eman live")).toBe("eman live");
  });

  it("keeps the joiner inside family, profession, flag and skin-tone emoji", () => {
    for (const e of ["👨‍👩‍👧", "🧑🏽‍🚀", "🏳️‍🌈", "👁️‍🗨️", "👩🏿‍❤️‍👨🏻", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "🇺🇸"]) {
      expect(cleanPlayerName(e)).toBe(e);
      expect(countNameChars(cleanPlayerName(e))).toBe(1);
    }
  });

  it("keeps joiners between letters of scripts that use them, drops stray ones", () => {
    expect(cleanPlayerName("ශ්‍රී")).toBe("ශ්‍රී"); // Sinhala
    expect(cleanPlayerName("می‌خواهم")).toBe("می‌خواهم"); // Persian non-joiner
    expect(cleanPlayerName("‍Sam‍")).toBe("Sam");
    expect(cleanPlayerName("Sam ‌‍ 😀")).toBe("Sam  😀");
    expect(cleanPlayerName("a‍😀")).toBe("a😀");
    expect(cleanPlayerName("😀‍a")).toBe("😀a");
  });

  it("leaves ordinary names and accents alone", () => {
    for (const n of ["Maya", "José", "Nguyện", "Zoë O'Neil", "李小龍", "Sam 👍🏽"]) expect(cleanPlayerName(n)).toBe(n);
  });

  it("needs at least one visible character", () => {
    expect(hasVisibleChar(cleanPlayerName("​".repeat(16)))).toBe(false);
    expect(hasVisibleChar(cleanPlayerName("ㅤㅤ"))).toBe(false);
    expect(hasVisibleChar("́́")).toBe(false);
    expect(hasVisibleChar("😀")).toBe(true);
    expect(hasVisibleChar("7")).toBe(true);
  });
});

describe("server uses the same cleanup", () => {
  it("rejects an invisible-only name with the friendly error", () => {
    for (const n of ["​".repeat(16), "ㅤ", "ᅟᅠ", "‮", "﻿⠀", "́"]) {
      const r = join(n);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Pick a name to join.");
      expect(HostAddPlayerSchema.safeParse({ displayName: n }).success).toBe(false);
    }
  });

  it("strips a right-to-left override before saving", () => {
    const r = join("‮evil name");
    expect(r.success && r.data.displayName).toBe("evil name");
  });

  it("does not count stripped invisibles toward 16", () => {
    const r = join("A".repeat(16) + "​".repeat(10));
    expect(r.success && r.data.displayName).toBe("A".repeat(16));
  });

  it("cleaning twice gives the same name (phone result always passes the server)", () => {
    for (const n of ["‍a‍😀‍", " ‮x ​", "ශ්‍රී ලංකා", "👨‍👩‍👧 Crew‍"]) {
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
