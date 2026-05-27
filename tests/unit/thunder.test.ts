// Tests for the procedural thunder synth.
//
// jsdom doesn't ship Web Audio, so we install a minimal mock on `window`
// before importing the module under test. The mock captures created nodes
// so we can assert the graph was wired correctly.
//
// We don't try to assert the actual sound — just that the right nodes are
// created, connected, and scheduled at the right times.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface MockAudioParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
}

interface MockNode {
  type?: string;
  frequency?: MockAudioParam;
  Q?: MockAudioParam;
  gain?: MockAudioParam;
  buffer?: AudioBuffer | null;
  connections: MockNode[];
  started?: number;
  stopped?: number;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeParam(initial = 0): MockAudioParam {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function makeNode(extra: Partial<MockNode> = {}): MockNode {
  const node: MockNode = {
    connections: [],
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    ...extra,
  };
  node.connect.mockImplementation((target: MockNode) => {
    node.connections.push(target);
    return target;
  });
  return node;
}

class MockAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  destination = makeNode();
  state: "running" | "suspended" = "running";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createdNodes: MockNode[] = [];
  createdBuffers: AudioBuffer[] = [];

  createGain(): MockNode {
    const n = makeNode({ gain: makeParam(1) });
    this.createdNodes.push(n);
    return n;
  }
  createBiquadFilter(): MockNode {
    const n = makeNode({
      frequency: makeParam(350),
      Q: makeParam(1),
      type: "lowpass",
    });
    this.createdNodes.push(n);
    return n;
  }
  createOscillator(): MockNode {
    const n = makeNode({
      frequency: makeParam(440),
      type: "sine",
    });
    this.createdNodes.push(n);
    return n;
  }
  createBufferSource(): MockNode {
    const n = makeNode({ buffer: null });
    this.createdNodes.push(n);
    return n;
  }
  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    const buf = {
      length,
      duration: length / sampleRate,
      sampleRate,
      numberOfChannels: 1,
      getChannelData: (_: number) => data,
    } as unknown as AudioBuffer;
    this.createdBuffers.push(buf);
    return buf;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __lastMockCtx: MockAudioContext | null;
}

beforeEach(() => {
  vi.resetModules();
  global.__lastMockCtx = null;
  (window as unknown as { AudioContext: unknown }).AudioContext = function () {
    const c = new MockAudioContext();
    global.__lastMockCtx = c;
    return c;
  } as unknown as typeof AudioContext;
});

afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  global.__lastMockCtx = null;
});

// Skipped 2026-05-27: Brandon disabled all sound effects across the app.
// playThunder is now an early-return no-op (see lib/audio/thunder.ts).
// If sound ever comes back, change `describe.skip` → `describe` here AND
// remove the `return null;` at the top of playThunder to revive both.
describe.skip("playThunder", () => {
  it("creates a noise source + lowpass + highpass + sub oscillator for a distant strike", async () => {
    const { playThunder } = await import("@/lib/audio/thunder");
    const result = playThunder({ distance: "distant", delayMs: 0 });
    expect(result).not.toBeNull();
    const ctx = global.__lastMockCtx!;
    // At least: 1 master gain (lazy init) + 2 filters + noise gain + sub osc + sub gain
    // = master(1) + lowpass(1) + highpass(1) + noiseGain(1) + osc(1) + subGain(1) = 6.
    expect(ctx.createdNodes.length).toBeGreaterThanOrEqual(6);
    // We should have created at least one buffer for the noise.
    expect(ctx.createdBuffers.length).toBeGreaterThanOrEqual(1);
  });

  it("creates an extra crack source on close strikes", async () => {
    const { playThunder } = await import("@/lib/audio/thunder");
    playThunder({ distance: "close", delayMs: 0 });
    const ctx = global.__lastMockCtx!;
    // Close strikes add: crack source + bandpass filter + crack gain
    // → 3 more nodes than distant.
    expect(ctx.createdNodes.length).toBeGreaterThanOrEqual(9);
    // Two buffers: main noise + crack.
    expect(ctx.createdBuffers.length).toBeGreaterThanOrEqual(2);
  });

  it("schedules the start time relative to ctx.currentTime plus delay", async () => {
    const { playThunder } = await import("@/lib/audio/thunder");
    const startAt = playThunder({ distance: "close", delayMs: 250 });
    const ctx = global.__lastMockCtx!;
    expect(startAt).toBeCloseTo(ctx.currentTime + 0.25, 5);
  });

  it("returns null when AudioContext is unavailable", async () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    const { playThunder } = await import("@/lib/audio/thunder");
    const result = playThunder({ distance: "close" });
    expect(result).toBeNull();
  });

  it("returns null when context is suspended and tries to resume", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = function () {
      const c = new MockAudioContext();
      c.state = "suspended";
      global.__lastMockCtx = c;
      return c;
    } as unknown as typeof AudioContext;

    const { playThunder } = await import("@/lib/audio/thunder");
    const result = playThunder({ distance: "close" });
    expect(result).toBeNull();
    const ctx = global.__lastMockCtx!;
    expect(ctx.resume).toHaveBeenCalled();
  });
});

describe("setThunderMuted", () => {
  it("sets the master gain to 0 when muted", async () => {
    const { setThunderMuted, isThunderMuted, playThunder } = await import("@/lib/audio/thunder");
    // Touch the audio system so the lazy init runs.
    playThunder({ distance: "close", delayMs: 0 });
    expect(isThunderMuted()).toBe(false);
    setThunderMuted(true);
    expect(isThunderMuted()).toBe(true);
    setThunderMuted(false);
    expect(isThunderMuted()).toBe(false);
  });
});

describe("unlockThunder", () => {
  it("calls ctx.resume when state is suspended", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = function () {
      const c = new MockAudioContext();
      c.state = "suspended";
      global.__lastMockCtx = c;
      return c;
    } as unknown as typeof AudioContext;

    const { unlockThunder } = await import("@/lib/audio/thunder");
    await unlockThunder();
    const ctx = global.__lastMockCtx!;
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("is a no-op when state is running", async () => {
    const { unlockThunder } = await import("@/lib/audio/thunder");
    await unlockThunder();
    const ctx = global.__lastMockCtx!;
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
