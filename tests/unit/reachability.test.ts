// reachability — module-level pub/sub for "can this surface reach the server?"
//
// Sibling of channelHealth.ts. useRoom's bootstrap sets it from the OUTCOME of
// the browser→Supabase reads: "ok" when a read succeeds, "unreachable" when the
// reads time out / fail (restrictive venue WiFi). The player ribbon + host
// banner read it to surface the "switch to hotspot" tier.

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  setReachability,
  getReachability,
  useReachability,
  __resetReachabilityForTests,
} from "@/lib/realtime/reachability";

afterEach(() => {
  __resetReachabilityForTests();
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
