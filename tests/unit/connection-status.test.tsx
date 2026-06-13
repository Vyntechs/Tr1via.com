// useConnectionStatus — tracks the browser's online state and the Supabase
// realtime channel's reconnection state. Returns one of:
//   "online"        — navigator.onLine && (no channel or channel SUBSCRIBED)
//   "reconnecting"  — channel is in CHANNEL_ERROR / TIMED_OUT / CLOSED
//                     but navigator says we're online (i.e. WS is flaky)
//   "offline"       — navigator.onLine is false

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConnectionStatus } from "@/lib/hooks/useConnectionStatus";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

describe("useConnectionStatus", () => {
  beforeEach(() => {
    setOnline(true);
  });
  afterEach(() => {
    setOnline(true);
  });

  it("reports 'online' when the browser is online and no channel is supplied", () => {
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current).toBe("online");
  });

  it("reports 'offline' when the browser goes offline", () => {
    const { result } = renderHook(() => useConnectionStatus());
    act(() => setOnline(false));
    expect(result.current).toBe("offline");
  });

  it("returns to 'online' when the browser comes back", () => {
    const { result } = renderHook(() => useConnectionStatus());
    act(() => setOnline(false));
    act(() => setOnline(true));
    expect(result.current).toBe("online");
  });

  it("reports 'reconnecting' when channelState is errored but browser online", () => {
    const { result, rerender } = renderHook(
      ({ channelState }: { channelState?: string }) => useConnectionStatus({ channelState }),
      { initialProps: { channelState: "SUBSCRIBED" as string | undefined } },
    );
    expect(result.current).toBe("online");
    rerender({ channelState: "CHANNEL_ERROR" });
    expect(result.current).toBe("reconnecting");
    rerender({ channelState: "TIMED_OUT" });
    expect(result.current).toBe("reconnecting");
  });

  it("prefers 'offline' over 'reconnecting' when the browser is offline", () => {
    const { result } = renderHook(() => useConnectionStatus({ channelState: "CHANNEL_ERROR" }));
    act(() => setOnline(false));
    expect(result.current).toBe("offline");
  });

  it("reports 'unreachable' when reachability is unreachable but the browser is online", () => {
    const { result } = renderHook(() =>
      useConnectionStatus({ reachability: "unreachable" }),
    );
    expect(result.current).toBe("unreachable");
  });

  it("prefers 'offline' over 'unreachable' when the browser is offline", () => {
    const { result } = renderHook(() =>
      useConnectionStatus({ reachability: "unreachable" }),
    );
    act(() => setOnline(false));
    expect(result.current).toBe("offline");
  });

  it("prefers 'unreachable' over 'reconnecting' when reads fail AND the socket is flaky", () => {
    const { result } = renderHook(() =>
      useConnectionStatus({ channelState: "CHANNEL_ERROR", reachability: "unreachable" }),
    );
    expect(result.current).toBe("unreachable");
  });

  it("reports 'backup' when running via the server route (degraded but working)", () => {
    const { result } = renderHook(() =>
      useConnectionStatus({ channelState: "CHANNEL_ERROR", reachability: "ok", backupMode: true }),
    );
    // Working-via-route outranks the flaky-socket 'reconnecting' tier.
    expect(result.current).toBe("backup");
  });

  it("prefers 'unreachable' over 'backup' when even the route is failing", () => {
    const { result } = renderHook(() =>
      useConnectionStatus({ reachability: "unreachable", backupMode: true }),
    );
    expect(result.current).toBe("unreachable");
  });

  it("returns to 'online' when reachability recovers to ok", () => {
    const { result, rerender } = renderHook(
      ({ reachability }: { reachability?: "ok" | "unreachable" }) =>
        useConnectionStatus({ reachability }),
      { initialProps: { reachability: "unreachable" as "ok" | "unreachable" | undefined } },
    );
    expect(result.current).toBe("unreachable");
    rerender({ reachability: "ok" });
    expect(result.current).toBe("online");
  });
});
