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
});
