// reachability — module-level pub/sub for "can this surface reach the server?"
//
// Sibling of channelHealth.ts. useRoom's bootstrap sets it from the OUTCOME of
// the browser→Supabase reads: "ok" when a read succeeds, "unreachable" when the
// reads time out / fail (restrictive venue WiFi). The player ribbon + host
// banner read it to surface the "switch to hotspot" tier.

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  setReachability,
  getReachability,
  getUnreachableSince,
  useReachability,
  useUnreachableFor,
  __resetReachabilityForTests,
} from "@/lib/realtime/reachability";

afterEach(() => {
  vi.useRealTimers();
  __resetReachabilityForTests();
});

describe("how long a surface has been unreachable", () => {
  it("stamps the start of a spell, keeps it through repeat failures, clears it on recovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(getUnreachableSince()).toBeNull();
    setReachability("unreachable");
    expect(getUnreachableSince()).toBe(1_000_000);
    vi.setSystemTime(1_005_000);
    setReachability("unreachable");
    expect(getUnreachableSince()).toBe(1_000_000);
    setReachability("ok");
    expect(getUnreachableSince()).toBeNull();
  });

  it("useUnreachableFor flips on the threshold and resets with the spell", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUnreachableFor(25_000));
    expect(result.current).toBe(false);
    act(() => setReachability("unreachable"));
    act(() => {
      vi.advanceTimersByTime(24_999);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);

    act(() => setReachability("ok"));
    expect(result.current).toBe(false);
    act(() => setReachability("unreachable"));
    act(() => {
      vi.advanceTimersByTime(24_999);
    });
    expect(result.current).toBe(false);
  });

  it("a surface mounting late counts from the start of the spell", () => {
    vi.useFakeTimers();
    setReachability("unreachable");
    vi.advanceTimersByTime(30_000);
    const { result } = renderHook(() => useUnreachableFor(25_000));
    expect(result.current).toBe(true);
  });
});

describe("reachability signal", () => {
  it("starts undefined (unknown until the first read settles)", () => {
    expect(getReachability()).toBeUndefined();
    const { result } = renderHook(() => useReachability());
    expect(result.current).toBeUndefined();
  });

  it("notifies subscribers when reachability flips to unreachable", () => {
    const { result } = renderHook(() => useReachability());
    act(() => setReachability("unreachable"));
    expect(result.current).toBe("unreachable");
    expect(getReachability()).toBe("unreachable");
  });

  it("clears the message on recovery (unreachable → ok)", () => {
    const { result } = renderHook(() => useReachability());
    act(() => setReachability("unreachable"));
    act(() => setReachability("ok"));
    expect(result.current).toBe("ok");
  });

  it("does not re-notify when the value is unchanged", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useReachability();
    });
    const before = renders;
    act(() => setReachability("ok"));
    act(() => setReachability("ok"));
    // The second identical set should not trigger an extra state update.
    expect(result.current).toBe("ok");
    expect(renders).toBe(before + 1);
  });
});
