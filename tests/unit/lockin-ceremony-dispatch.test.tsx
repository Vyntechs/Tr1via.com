// TVLockInCeremony dispatch: the per-player flourish must match the theme's
// ceremony kind — July ("fireworks") fires a tinted Pyrotechnics burst, May
// ("lightning", the default) fires a tinted Lightning strike. The queue/mode
// machinery (decideMode, spotlight, drain) is theme-agnostic and covered by
// ceremony-mode-switch.test.ts; here we only assert the fork.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TVLockInCeremony, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";
import { fireLightningBeat } from "@/components/system/Lightning";
import { fireLockInBurst } from "@/components/system/Pyrotechnics";

vi.mock("@/components/system/Lightning", () => ({ fireLightningBeat: vi.fn() }));
vi.mock("@/components/system/Pyrotechnics", () => ({ fireLockInBurst: vi.fn() }));

const TINT = "#E63946";
function oneEvent(): CeremonyEvent[] {
  return [{ playerId: "p1", tint: TINT, msToLock: 1200, receivedAtMs: Date.now() }];
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("TVLockInCeremony — per-theme dispatch", () => {
  it("July (ceremony='fireworks') fires a tinted firework burst, not lightning", () => {
    render(<TVLockInCeremony events={oneEvent()} ceremony="fireworks" />);
    expect(fireLockInBurst).toHaveBeenCalledWith(TINT);
    expect(fireLightningBeat).not.toHaveBeenCalled();
  });

  it("May (ceremony='lightning') fires a tinted lightning strike, not a firework", () => {
    render(<TVLockInCeremony events={oneEvent()} ceremony="lightning" />);
    expect(fireLightningBeat).toHaveBeenCalledWith("close", { tint: TINT });
    expect(fireLockInBurst).not.toHaveBeenCalled();
  });

  it("defaults to lightning when no ceremony prop is given (back-compat)", () => {
    render(<TVLockInCeremony events={oneEvent()} />);
    expect(fireLightningBeat).toHaveBeenCalledWith("close", { tint: TINT });
    expect(fireLockInBurst).not.toHaveBeenCalled();
  });
});
