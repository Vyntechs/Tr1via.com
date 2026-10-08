// trackedCall / settleJobScope: a log job must not let go of its turn just
// because the APP stopped waiting for a database call. Cancelling the HTTP
// request does not stop the statement behind it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJobScope,
  DiagTimeout,
  runInJobScope,
  settleJobScope,
  trackedCall,
  withDeadline,
} from "@/lib/diagnostics/deadline";

const OPTIONS = { ceilingMs: 12_000, holdAfterAbortMs: 2_000 };

/** A call that only ends when the test says so. */
function manual<T = string>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  let signal: AbortSignal | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    work: (s: AbortSignal) => {
      signal = s;
      return promise;
    },
    resolve,
    reject,
    get signal() {
      return signal;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("trackedCall", () => {
  it("returns the answer, and does not cancel the request, when the database answers", async () => {
    const call = manual();
    const result = trackedCall(call.work, OPTIONS);
    call.resolve("ok");
    await expect(result).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(60_000); // the ceiling timer is gone
    expect(call.signal?.aborted).toBe(false);
  });

  it("passes a database error answer through as it is (it is an answer, not a time-out)", async () => {
    const call = manual();
    const result = trackedCall(call.work, OPTIONS);
    call.reject(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }));
    await expect(result).rejects.toMatchObject({ code: "57014" });
  });

  it("cancels the request only at the ceiling, and says DiagTimeout", async () => {
    const call = manual();
    const result = trackedCall(call.work, OPTIONS).catch((e) => e);
    await vi.advanceTimersByTimeAsync(OPTIONS.ceilingMs - 1);
    expect(call.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(call.signal?.aborted).toBe(true);
    expect(await result).toBeInstanceOf(DiagTimeout);
  });

  it("lets the CALLER stop waiting early (giveUpAfterMs) while the call carries on and is not cancelled", async () => {
    const call = manual();
    const scope = createJobScope(Date.now() + 60_000);
    const result = runInJobScope(scope, () => trackedCall(call.work, { ...OPTIONS, giveUpAfterMs: 2_000 })).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await result).toBeInstanceOf(DiagTimeout);
    expect(call.signal?.aborted).toBe(false); // nobody hung up
    expect(scope.calls.size).toBe(1); // and the job still counts the call as running
    call.resolve("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(scope.calls.size).toBe(0);
  });

  it("never starts a call after the job's deadline (nothing is sent)", async () => {
    const work = vi.fn(async () => "x");
    const scope = createJobScope(Date.now() + 1_000);
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(runInJobScope(scope, () => trackedCall(work, OPTIONS))).rejects.toBeInstanceOf(DiagTimeout);
    expect(work).not.toHaveBeenCalled();
  });

  it("starts no new call while an earlier one, cancelled at the ceiling, may still be running", async () => {
    const stuck = manual();
    const scope = createJobScope(Date.now() + 60_000);
    const first = runInJobScope(scope, () => trackedCall(stuck.work, OPTIONS)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(OPTIONS.ceilingMs + 1);
    expect(await first).toBeInstanceOf(DiagTimeout);
    const work = vi.fn(async () => "x");
    await expect(runInJobScope(scope, () => trackedCall(work, OPTIONS))).rejects.toBeInstanceOf(DiagTimeout);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(OPTIONS.holdAfterAbortMs + 1);
    await expect(runInJobScope(scope, () => trackedCall(work, OPTIONS))).resolves.toBe("x");
  });

  it("works outside a job too (no scope to tell)", async () => {
    const call = manual();
    const result = trackedCall(call.work, OPTIONS);
    call.resolve("fine");
    await expect(result).resolves.toBe("fine");
  });
});

describe("settleJobScope", () => {
  it("is immediate when the job has no call outstanding", async () => {
    const scope = createJobScope(Date.now() + 5_000);
    await expect(settleJobScope(scope)).resolves.toBeUndefined();
  });

  it("waits until every call has returned", async () => {
    const call = manual();
    const scope = createJobScope(Date.now() + 60_000);
    void runInJobScope(scope, () => trackedCall(call.work, { ...OPTIONS, giveUpAfterMs: 1_000 })).catch(() => {});
    await vi.advanceTimersByTimeAsync(1_500); // the caller gave up long ago
    let settled = false;
    void settleJobScope(scope).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false); // the statement is still running: the turn must stay
    call.resolve("done");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("after a cancel at the ceiling, waits out the hold", async () => {
    const stuck = manual();
    const scope = createJobScope(Date.now() + 60_000);
    void runInJobScope(scope, () => trackedCall(stuck.work, OPTIONS)).catch(() => {});
    await vi.advanceTimersByTimeAsync(OPTIONS.ceilingMs + 1);
    let settled = false;
    void settleJobScope(scope).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(OPTIONS.holdAfterAbortMs - 100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
  });
});

describe("withDeadline (the sign-in service) is unchanged", () => {
  it("stops waiting and cancels at the deadline, clipped to what is left of the job", async () => {
    const call = manual();
    const scope = createJobScope(Date.now() + 500);
    const result = runInJobScope(scope, () => withDeadline(2_000, call.work)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(501);
    expect(await result).toBeInstanceOf(DiagTimeout);
    expect(call.signal?.aborted).toBe(true);
  });
});
