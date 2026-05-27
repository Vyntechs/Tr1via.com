import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TVLockInCeremony, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";

vi.mock("@/components/system/Lightning", async () => ({
  fireLightningBeat: vi.fn(),
}));
import { fireLightningBeat } from "@/components/system/Lightning";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TVLockInCeremony", () => {
  it("fires fireLightningBeat with the player's tint on each event", async () => {
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(<TVLockInCeremony events={events} />);
    await waitFor(() => expect(fireLightningBeat).toHaveBeenCalled());
    expect(fireLightningBeat).toHaveBeenCalledWith("close", { tint: "#E64A8C" });
  });

  it("calls onSpotlight in calm mode (single event)", async () => {
    const onSpotlight = vi.fn();
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(<TVLockInCeremony events={events} onSpotlight={onSpotlight} />);
    await waitFor(() => expect(onSpotlight).toHaveBeenCalledWith("p1"));
  });

  it("calls onEventComplete after the ceremony duration", async () => {
    vi.useFakeTimers();
    const onEventComplete = vi.fn();
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(<TVLockInCeremony events={events} onEventComplete={onEventComplete} />);
    await vi.advanceTimersByTimeAsync(1500);
    expect(onEventComplete).toHaveBeenCalledWith("p1");
    vi.useRealTimers();
  });

  it("does NOT call onSpotlight in storm mode (2+ pending)", async () => {
    vi.useFakeTimers();
    const onSpotlight = vi.fn();
    const now = Date.now();
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#fff", msToLock: 2000, receivedAtMs: now },
      { playerId: "p2", tint: "#fff", msToLock: 2000, receivedAtMs: now },
    ];
    render(<TVLockInCeremony events={events} onSpotlight={onSpotlight} />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSpotlight).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
