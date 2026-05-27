import { describe, it, expect } from "vitest";
import { decideMode, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";

const ev = (id: string, at: number): CeremonyEvent => ({
  playerId: id,
  tint: "#fff",
  msToLock: 2000,
  receivedAtMs: at,
});

describe("decideMode", () => {
  it("returns calm when no pending and no recent strikes", () => {
    expect(decideMode({ pending: [], recent: [], nowMs: 1000 })).toBe("calm");
  });

  it("returns calm when one strike landed recently but queue empty", () => {
    expect(decideMode({ pending: [], recent: [ev("a", 700)], nowMs: 1000 })).toBe("calm");
  });

  it("returns storm when 2+ pending", () => {
    expect(decideMode({ pending: [ev("a", 900), ev("b", 950)], recent: [], nowMs: 1000 })).toBe("storm");
  });

  it("returns storm when 3+ strikes in the last 1500ms", () => {
    expect(
      decideMode({
        pending: [],
        recent: [ev("a", 100), ev("b", 600), ev("c", 900)],
        nowMs: 1000,
      })
    ).toBe("storm");
  });

  it("ignores strikes older than the 1500ms window", () => {
    expect(
      decideMode({
        pending: [],
        recent: [ev("a", -2000), ev("b", -1700), ev("c", -1600)],
        nowMs: 1000,
      })
    ).toBe("calm");
  });
});
