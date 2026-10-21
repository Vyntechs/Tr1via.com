import { describe, expect, it, vi } from "vitest";
import { createGenerationHeartbeat } from "@/lib/ai/generation-heartbeat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createGenerationHeartbeat", () => {
  it("keeps one durable heartbeat write in flight and drains it before terminal work", async () => {
    const firstWrite = deferred<void>();
    const write = vi.fn(() => firstWrite.promise);
    const heartbeat = createGenerationHeartbeat(write);

    heartbeat.beat();
    heartbeat.beat();
    const drained = heartbeat.drain();

    expect(write).toHaveBeenCalledTimes(1);
    let finished = false;
    void drained.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    firstWrite.resolve();
    await drained;
    expect(finished).toBe(true);
  });

  it("drain never throws, so a failed last heartbeat can't fail a finished build", async () => {
    // The route's stopLiveSignals awaits drain() in the outer finally, right
    // before completeQuestionGeneration. A one-off database error on the
    // in-flight heartbeat used to reject here and turn a saved 20/20 build
    // into "paused".
    const pending = deferred<void>();
    const write = vi.fn(() =>
      pending.promise.then(() => {
        throw new Error("transient db error");
      }),
    );
    const heartbeat = createGenerationHeartbeat(write);
    heartbeat.beat().catch(() => undefined);

    let completed = false;
    const finishBuild = async () => {
      await heartbeat.drain(); // what stopLiveSignals does last
      completed = true; // stands in for completeQuestionGeneration
    };
    const run = finishBuild();
    pending.resolve();
    await expect(run).resolves.toBeUndefined();
    expect(completed).toBe(true);
    // And a fresh beat after that still works.
    await expect(heartbeat.drain()).resolves.toBeUndefined();
  });

  it("lets a broadcast wait for its fenced durable write", async () => {
    const pending = deferred<void>();
    const heartbeat = createGenerationHeartbeat(() => pending.promise);

    const write = heartbeat.beat();
    expect(write).toBeInstanceOf(Promise);

    pending.resolve();
    await write;
  });
});
