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
});
