// channelHealth — module-level pub/sub used by useRoom to publish Realtime
// channel state, and by ConnectionRibbonProvider to render the "Reconnecting…"
// ribbon when a channel drops.

import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  setChannelHealth,
  useChannelHealth,
  __resetChannelHealthForTests,
} from "@/lib/realtime/channelHealth";

describe("channelHealth", () => {
  beforeEach(() => {
    __resetChannelHealthForTests();
  });

  it("starts undefined", () => {
    const { result } = renderHook(() => useChannelHealth());
    expect(result.current).toBeUndefined();
  });

  it("notifies subscribers when status changes", () => {
    const { result } = renderHook(() => useChannelHealth());
    act(() => setChannelHealth("SUBSCRIBED"));
    expect(result.current).toBe("SUBSCRIBED");
    act(() => setChannelHealth("CHANNEL_ERROR"));
    expect(result.current).toBe("CHANNEL_ERROR");
  });

  it("does not re-notify on no-op transitions", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useChannelHealth();
    });
    const initialRenders = renderCount;
    act(() => setChannelHealth("SUBSCRIBED"));
    const afterFirstSet = renderCount;
    act(() => setChannelHealth("SUBSCRIBED")); // identical — should be skipped
    expect(renderCount).toBe(afterFirstSet);
    expect(result.current).toBe("SUBSCRIBED");
    expect(afterFirstSet).toBeGreaterThan(initialRenders);
  });

  it("unmount removes the listener", () => {
    const { result, unmount } = renderHook(() => useChannelHealth());
    act(() => setChannelHealth("SUBSCRIBED"));
    expect(result.current).toBe("SUBSCRIBED");
    unmount();
    // After unmount the hook's state is gone; the singleton still works for others.
    act(() => setChannelHealth("CLOSED"));
    // A fresh consumer sees the latest:
    const { result: result2 } = renderHook(() => useChannelHealth());
    expect(result2.current).toBe("CLOSED");
  });

  it("supports clearing to undefined", () => {
    const { result } = renderHook(() => useChannelHealth());
    act(() => setChannelHealth("SUBSCRIBED"));
    expect(result.current).toBe("SUBSCRIBED");
    act(() => setChannelHealth(undefined));
    expect(result.current).toBeUndefined();
  });
});
