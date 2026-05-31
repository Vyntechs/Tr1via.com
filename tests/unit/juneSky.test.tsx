import { describe, it, expect, vi } from "vitest";
import { fireJuneBeat, __subscribeJuneBeatForTest } from "@/components/system/JuneSky";

describe("June beat module", () => {
  it("notifies subscribers when a beat fires", () => {
    const seen: string[] = [];
    const unsub = __subscribeJuneBeatForTest((kind) => seen.push(kind));
    fireJuneBeat("lock");
    fireJuneBeat("reveal");
    expect(seen).toEqual(["lock", "reveal"]);
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const fn = vi.fn();
    const unsub = __subscribeJuneBeatForTest(fn);
    unsub();
    fireJuneBeat("lock");
    expect(fn).not.toHaveBeenCalled();
  });
});
