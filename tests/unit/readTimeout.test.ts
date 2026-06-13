// withTimeout — bounds a hung promise (e.g. a browser→Supabase read that
// never settles on restrictive venue WiFi) so the caller can fast-fail to an
// "unreachable" state instead of spinning forever.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withTimeout,
  TimeoutError,
  BOOTSTRAP_TIMEOUT_MS,
} from "@/lib/realtime/readTimeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the value when the promise settles before the timeout", async () => {
    const p = withTimeout(Promise.resolve("ok"), 5000);
    await expect(p).resolves.toBe("ok");
  });

  it("rejects with the original error when the promise rejects before the timeout", async () => {
    const boom = new Error("boom");
    const p = withTimeout(Promise.reject(boom), 5000);
    await expect(p).rejects.toBe(boom);
  });

  it("rejects with a TimeoutError when the promise never settles within ms", async () => {
    const never = new Promise<string>(() => {});
    const p = withTimeout(never, 5000);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });

  it("does not fire the timeout once the promise has already resolved", async () => {
    let resolve!: (v: string) => void;
    const slow = new Promise<string>((r) => {
      resolve = r;
    });
    const p = withTimeout(slow, 5000);
    resolve("done");
    await expect(p).resolves.toBe("done");
    // Advancing past the deadline must not turn a resolved promise into a reject.
    await vi.advanceTimersByTimeAsync(10000);
    await expect(p).resolves.toBe("done");
  });

  it("exposes a sane default bootstrap budget (~5s)", () => {
    expect(BOOTSTRAP_TIMEOUT_MS).toBe(5000);
  });
});
