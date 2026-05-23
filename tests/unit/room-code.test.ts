import { describe, it, expect } from "vitest";
import {
  ALPHABET,
  newRoomCode,
  formatRoomCode,
  parseRoomCode,
  isValidRoomCode,
} from "@/lib/game/room-code";

describe("ALPHABET", () => {
  it("is the Crockford-style ambiguity-free set (A-Z minus I/L/O, plus 2-9)", () => {
    expect(ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    // 23 letters (A-Z minus I/L/O) + 8 digits (2-9) = 31.
    expect(ALPHABET).toHaveLength(31);
  });

  it("excludes confusable characters (0, O, 1, I, L)", () => {
    expect(ALPHABET).not.toContain("0");
    expect(ALPHABET).not.toContain("O");
    expect(ALPHABET).not.toContain("1");
    expect(ALPHABET).not.toContain("I");
    expect(ALPHABET).not.toContain("L");
  });
});

describe("newRoomCode", () => {
  it("returns 6 characters", () => {
    expect(newRoomCode()).toHaveLength(6);
  });

  it("only uses characters from the alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const code = newRoomCode();
      for (const ch of code) {
        expect(ALPHABET, `'${ch}' from code '${code}' must be in alphabet`).toContain(ch);
      }
    }
  });

  it("produces >95 unique values in 100 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(newRoomCode());
    expect(seen.size).toBeGreaterThan(95);
  });
});

describe("formatRoomCode", () => {
  it("inserts a middle dot at position 3 for 6-char codes", () => {
    expect(formatRoomCode("K9PR4M")).toBe("K9P·R4M");
  });

  it("returns the input unchanged when length !== 6", () => {
    expect(formatRoomCode("ABC")).toBe("ABC");
    expect(formatRoomCode("ABCDEFG")).toBe("ABCDEFG");
    expect(formatRoomCode("")).toBe("");
  });

  it("uppercases the input before formatting", () => {
    expect(formatRoomCode("k9pr4m")).toBe("K9P·R4M");
  });
});

describe("parseRoomCode", () => {
  it("strips the middle dot", () => {
    expect(parseRoomCode("K9P·R4M")).toBe("K9PR4M");
  });

  it("uppercases the input", () => {
    expect(parseRoomCode("k9pr4m")).toBe("K9PR4M");
    expect(parseRoomCode("k9p·r4m")).toBe("K9PR4M");
  });

  it("strips whitespace too", () => {
    expect(parseRoomCode("  K9P·R4M  ")).toBe("K9PR4M");
    expect(parseRoomCode("K9 PR 4M")).toBe("K9PR4M");
  });
});

describe("format/parse round-trip", () => {
  it("format(parse(format(code))) === format(code)", () => {
    for (let i = 0; i < 20; i++) {
      const code = newRoomCode();
      const formatted = formatRoomCode(code);
      expect(formatRoomCode(parseRoomCode(formatted))).toBe(formatted);
    }
  });

  it("parse(format(code)) === code", () => {
    for (let i = 0; i < 20; i++) {
      const code = newRoomCode();
      expect(parseRoomCode(formatRoomCode(code))).toBe(code);
    }
  });
});

describe("isValidRoomCode", () => {
  it("accepts valid 6-char codes from the alphabet", () => {
    expect(isValidRoomCode("K9PR4M")).toBe(true);
    expect(isValidRoomCode("ABCDEF")).toBe(true);
    expect(isValidRoomCode("23456789".slice(0, 6))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidRoomCode("")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidRoomCode("K9PR4")).toBe(false);
    expect(isValidRoomCode("K9PR4MX")).toBe(false);
  });

  it("rejects characters outside the alphabet", () => {
    expect(isValidRoomCode("K9PR40")).toBe(false); // 0
    expect(isValidRoomCode("K9PR4O")).toBe(false); // O
    expect(isValidRoomCode("K9PR41")).toBe(false); // 1
    expect(isValidRoomCode("K9PR4I")).toBe(false); // I
    expect(isValidRoomCode("K9PR4L")).toBe(false); // L
    expect(isValidRoomCode("K9PR4!")).toBe(false);
  });

  it("rejects lowercase", () => {
    expect(isValidRoomCode("k9pr4m")).toBe(false);
  });

  it("rejects the formatted (dotted) form", () => {
    // Storage is undotted; display uses formatRoomCode.
    expect(isValidRoomCode("K9P·R4M")).toBe(false);
  });

  it("rejects non-string values", () => {
    // @ts-expect-error — deliberately passing junk
    expect(isValidRoomCode(null)).toBe(false);
    // @ts-expect-error — deliberately passing junk
    expect(isValidRoomCode(undefined)).toBe(false);
    // @ts-expect-error — deliberately passing junk
    expect(isValidRoomCode(123456)).toBe(false);
  });
});
