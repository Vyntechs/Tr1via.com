import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHostPollLoop } from "@/lib/host/hostPollLoop";

const middle = () => 0.5; // no spread: the gap is exactly 2,000ms

function hungRead() {
  return vi.fn(
    (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve());
      }),
  );
}

describe("startHostPollLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads straight away, then 2s after each read ends", async () => {
    const read = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const loop = startHostPollLoop(read, middle);
    expect(read).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("never has two reads running, and aborts a hung one at 4s", async () => {
    const read = hungRead();
    const loop = startHostPollLoop(read, middle);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(read.mock.calls[0][0].aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("a read that ignores its signal still can't hold the loop", async () => {
    const read = vi.fn(() => new Promise<void>(() => undefined));
    const loop = startHostPollLoop(read, middle);

    await vi.advanceTimersByTimeAsync(6_000);

    expect(read).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it.each([
    [0, 1_700],
    [1, 2_300],
  ])("spreads the gap by 15%% either way (rand %d: %dms)", async (rand, gap) => {
    const read = vi.fn(async () => undefined);
    const loop = startHostPollLoop(read, () => rand);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(gap - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("many kicks during a read become one read right after it", async () => {
    let finish!: () => void;
    const read = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const loop = startHostPollLoop(read, middle);

    for (let index = 0; index < 40; index += 1) loop.kick();
    expect(read).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("a kick between reads reads now and restarts the gap", async () => {
    const read = vi.fn(async () => undefined);
    const loop = startHostPollLoop(read, middle);
    await vi.advanceTimersByTimeAsync(1_000);

    loop.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);

    loop.stop();
  });

  it("keeps going after a read throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const read = vi.fn(async () => {
      throw new Error("boom");
    });
    const loop = startHostPollLoop(read, middle);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(read).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it("stop aborts the running read and schedules nothing more", async () => {
    const read = hungRead();
    const loop = startHostPollLoop(read, middle);

    loop.stop();
    expect(read.mock.calls[0][0].aborted).toBe(true);

    loop.kick();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
