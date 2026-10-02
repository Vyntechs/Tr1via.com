// The theme safety net, effect side: if a theme piece ITSELF throws from an
// effect (not while drawing), it switches off cleanly. Here the ceremony's
// and the fireworks conductor's own calls are made to throw; the real
// listener guards inside those calls are tested in ThemeSignals.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("@/components/system/Lightning", async () => ({
  fireLightningBeat: vi.fn(() => {
    throw new Error("lightning exploded");
  }),
}));
vi.mock("@/components/system/Pyrotechnics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/system/Pyrotechnics")>()),
  publishPyrotechnicsBeat: vi.fn(() => {
    throw new Error("fireworks exploded");
  }),
}));

import { TVLockInCeremony, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";
import { PyrotechnicsBeatConductor } from "@/components/system/PyrotechnicsBeatConductor";
import { guardThemeCall } from "@/components/system/ThemeLayerBoundary";

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("theme safety net — effects and signals", () => {
  it("switches off a lock-in ceremony whose effect throws, and drains its queue", async () => {
    const warn = quiet();
    const onSpotlight = vi.fn();
    const onEventComplete = vi.fn();
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(
      <div>
        <TVLockInCeremony
          events={events}
          onSpotlight={onSpotlight}
          onEventComplete={onEventComplete}
        />
        <p>question still up</p>
      </div>,
    );
    await waitFor(() => expect(onEventComplete).toHaveBeenCalledWith("p1"));
    // Nothing is left spotlighted, so the TV never waits on a dead queue.
    expect(onSpotlight).toHaveBeenLastCalledWith(null);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"lock-in-ceremony" switched off'))).toBe(true);
  });

  it("switches off the July firework beat when its effect throws", () => {
    const warn = quiet();
    const now = Date.now();
    const { container } = render(
      <PyrotechnicsBeatConductor
        beat={{
          kind: "salvo",
          fireAt: new Date(now + 500).toISOString(),
          serverNow: new Date(now).toISOString(),
          receivedAtMs: now,
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"fireworks-beat" switched off'))).toBe(true);
  });

  it("guardThemeCall logs a given failure once, not every frame", () => {
    const warn = quiet();
    for (let i = 0; i < 5; i++) {
      guardThemeCall("test-signal-once", () => {
        throw new Error("nope");
      });
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("test-signal-once"))).toHaveLength(1);
  });
});
