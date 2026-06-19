// Module-level lock-in burst pub/sub (canvas-free). The visual burst itself
// needs a 2D context jsdom can't provide, so here we verify only the plumbing:
// fireLockInBurst notifies live subscribers with the tint, stops after
// unsubscribe, and is a safe no-op when nothing is mounted (non-July themes).

import { describe, it, expect, vi } from "vitest";
import { fireLockInBurst, __pyroLockInTest } from "@/components/system/Pyrotechnics";

describe("fireLockInBurst (module pub/sub)", () => {
  it("notifies subscribers with the player tint and stops after unsubscribe", () => {
    const spy = vi.fn();
    const unsubscribe = __pyroLockInTest.subscribe(spy);

    fireLockInBurst("#E63946");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("#E63946");

    unsubscribe();
    fireLockInBurst("#FFD93D");
    expect(spy).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  it("is a no-op (never throws) with no engine mounted", () => {
    expect(() => fireLockInBurst("#4DA6FF")).not.toThrow();
  });
});
