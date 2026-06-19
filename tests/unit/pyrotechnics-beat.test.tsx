// Tests for the synchronized firework beat (Phase 2): the conductor's
// clock-aware scheduling (computeBeatDelayMs), the engine's per-mount schedule
// rule (planEngineBeat), the publish + once-per-surface de-dup, and the
// conductor → publish wiring. The canvas burst itself is visual (jsdom has no
// 2D context) and is verified live, not here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import {
  computeBeatDelayMs,
  PyrotechnicsBeatConductor,
  type FireworksBeat,
} from "@/components/system/PyrotechnicsBeatConductor";
import {
  publishPyrotechnicsBeat,
  planEngineBeat,
  __pyroBeatTest,
} from "@/components/system/Pyrotechnics";

// A fixed server epoch to anchor every scenario.
const S = 1_700_000_000_000;

function beat(over: Partial<FireworksBeat> & { leadMs?: number } = {}): FireworksBeat {
  const lead = over.leadMs ?? 450;
  return {
    kind: over.kind ?? "salvo",
    serverNow: over.serverNow ?? new Date(S).toISOString(),
    fireAt: over.fireAt ?? new Date(S + lead).toISOString(),
    receivedAtMs: over.receivedAtMs ?? S + 60, // 60ms one-way latency
  };
}

beforeEach(() => {
  __pyroBeatTest.reset();
});

describe("computeBeatDelayMs", () => {
  it("trusts the wall clock when device + server agree (true cross-device sync)", () => {
    const d = computeBeatDelayMs(beat(), S + 65);
    expect(d).toBe(450 - 65); // 385
  });

  it("falls back to receipt+lead when the device clock runs FAST", () => {
    const d = computeBeatDelayMs(beat({ receivedAtMs: S + 2060 }), S + 2065);
    expect(d).toBe(450 - 5); // lead - age = 445
  });

  it("falls back to receipt+lead when the device clock runs SLOW", () => {
    const d = computeBeatDelayMs(beat({ receivedAtMs: S - 2940 }), S - 2935);
    expect(d).toBe(450 - 5); // 445
  });

  it("fires immediately (0) when the instant just passed but the beat is fresh", () => {
    const d = computeBeatDelayMs(beat(), S + 500);
    expect(d).toBe(0);
  });

  it("SKIPS a genuinely stale beat (mounted long after it fired)", () => {
    expect(computeBeatDelayMs(beat({ receivedAtMs: S + 60 }), S + 60 + 5000)).toBeNull();
  });

  it("SKIPS a malformed beat rather than firing on garbage", () => {
    expect(computeBeatDelayMs(beat({ fireAt: "not-a-date" }), S + 65)).toBeNull();
    expect(computeBeatDelayMs(beat({ serverNow: "" }), S + 65)).toBeNull();
    expect(computeBeatDelayMs(beat({ receivedAtMs: Number.NaN }), S + 65)).toBeNull();
  });

  it("honors the longer finale lead", () => {
    expect(computeBeatDelayMs(beat({ leadMs: 700 }), S + 65)).toBe(700 - 65); // 635
  });
});

describe("planEngineBeat — per-mount schedule rule (honors the shared target)", () => {
  const b = (id: number, targetAtMs: number) =>
    ({ id, kind: "salvo" as const, targetAtMs });

  it("schedules a future target at its remaining delay (not immediately)", () => {
    expect(planEngineBeat(b(1, S + 300), 0, S)).toEqual({ waitMs: 300 });
  });

  it("fires immediately (0) for a target that just passed but is still fresh", () => {
    expect(planEngineBeat(b(1, S - 100), 0, S)).toEqual({ waitMs: 0 });
  });

  it("SKIPS a beat already claimed by another engine on this surface (no double)", () => {
    expect(planEngineBeat(b(7, S + 300), 7, S)).toBeNull();
  });

  it("SKIPS a stale target (engine mounted long after the instant)", () => {
    expect(planEngineBeat(b(1, S - 2000), 0, S)).toBeNull();
  });

  it("SKIPS an implausibly far-future target", () => {
    expect(planEngineBeat(b(1, S + 5000), 0, S)).toBeNull();
  });

  it("returns null when there is no beat", () => {
    expect(planEngineBeat(null, 0, S)).toBeNull();
  });
});

describe("publishPyrotechnicsBeat + once-per-surface de-dup", () => {
  it("publishes a beat with a monotonic id and a local target instant, and notifies subscribers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(S));
    let woke = 0;
    const unsub = __pyroBeatTest.subscribe(() => { woke += 1; });

    publishPyrotechnicsBeat("salvo", 400);
    const st = __pyroBeatTest.state();
    expect(st.current).toMatchObject({ kind: "salvo", targetAtMs: S + 400 });
    expect(st.current?.id).toBeGreaterThan(0);
    expect(woke).toBe(1);

    unsub();
    vi.useRealTimers();
  });

  it("fires a beat at most once per surface; a superseding beat bumps the id and can fire again", () => {
    publishPyrotechnicsBeat("salvo", 400);
    const firstId = __pyroBeatTest.state().current?.id;
    expect(__pyroBeatTest.claimCurrent()).toBe("salvo");
    expect(__pyroBeatTest.state().lastFiredId).toBe(firstId);
    // A second engine on the same surface must NOT replay the same beat.
    expect(__pyroBeatTest.claimCurrent()).toBeNull();

    // The game-end finale supersedes — new id → can fire.
    publishPyrotechnicsBeat("finale", 300);
    expect(__pyroBeatTest.state().current?.id).toBeGreaterThan(firstId ?? 0);
    expect(__pyroBeatTest.claimCurrent()).toBe("finale");
  });
});

describe("PyrotechnicsBeatConductor → publish wiring", () => {
  it("publishes the beat at the clock-aware target on mount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(S));
    // Accurate clock, received now, finale lead 700.
    render(
      <PyrotechnicsBeatConductor
        beat={beat({ kind: "finale", leadMs: 700, serverNow: new Date(S).toISOString(), receivedAtMs: S })}
      />,
    );
    const st = __pyroBeatTest.state();
    expect(st.current).toMatchObject({ kind: "finale", targetAtMs: S + 700 });
    vi.useRealTimers();
  });

  it("publishes nothing for a null beat", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(S));
    render(<PyrotechnicsBeatConductor beat={null} />);
    expect(__pyroBeatTest.state().current).toBeNull();
    vi.useRealTimers();
  });

  it("publishes nothing for a stale beat (does not replay on mount)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(S + 5000));
    render(<PyrotechnicsBeatConductor beat={beat({ receivedAtMs: S })} />);
    expect(__pyroBeatTest.state().current).toBeNull();
    vi.useRealTimers();
  });
});
