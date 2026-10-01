// The October patch canvas actually drawing: every moment of the night runs
// through the real animation loop against a recording stand-in for the
// browser's 2D canvas (jsdom has none), and a crash inside the loop switches
// the world off instead of breaking the TV.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { OctoberPatchCanvas, type OctoberPatchInputs } from "@/components/experience/october/OctoberPatchCanvas";
import { patchScene, type PatchPlayer } from "@/lib/experience/october/patch";
import type { TVMoment } from "@/lib/experience/tvMoment";

type Calls = Record<string, unknown[][]>;

function recordingContext(calls: Calls, explodeOn?: string) {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return (text: string) => ({ width: String(text).length * 7 });
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return () => ({ addColorStop: () => {} });
      }
      return (...args: unknown[]) => {
        if (prop === explodeOn) throw new Error(`${prop} exploded`);
        (calls[prop] ??= []).push(args);
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
}

let calls: Calls;
let explodeOn: string | undefined;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const RealImage = window.Image;

beforeEach(() => {
  calls = {};
  explodeOn = undefined;
  HTMLCanvasElement.prototype.getContext = function () {
    return recordingContext(calls, explodeOn) as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement["getContext"];
  // Art loads instantly.
  class InstantImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "async";
    width = 160;
    height = 200;
    set src(_value: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  (window as unknown as { Image: unknown }).Image = InstantImage;
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1600, height: 900, top: 0, left: 0, right: 1600, bottom: 900, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  (window as unknown as { Image: unknown }).Image = RealImage;
  vi.restoreAllMocks();
});

const players: PatchPlayer[] = Array.from({ length: 41 }, (_, i) => ({ key: `p${i}`, name: `Player number ${i}` }));
const Q = "q1";
const REVEALED = Date.now() - 24_000;
const momentOf = (kind: TVMoment["kind"]): TVMoment =>
  kind === "question"
    ? { kind, questionId: Q, revealedAtMs: REVEALED, serverNowMs: null }
    : { kind, questionId: kind === "reveal" ? Q : null, revealedAtMs: null, serverNowMs: null };

function inputsFor(kind: TVMoment["kind"]): OctoberPatchInputs {
  const answers = players.slice(0, 30).map((p, i) => ({
    playerKey: p.key,
    questionId: Q,
    isCorrect: kind === "reveal" ? i % 4 !== 0 : null,
  }));
  const moment = momentOf(kind);
  const scene = patchScene({ moment, players, answers, serverNowMs: Date.now() });
  return {
    players,
    scene,
    secondsLeftNow: () => (kind === "question" ? 25 - (Date.now() - REVEALED) / 1000 : null),
    colorFor: () => "#F5C451",
  };
}

describe("October patch canvas", () => {
  for (const kind of ["lobby", "board", "question", "reveal", "between-games", "winner"] as const) {
    it(`draws the ${kind} moment without failing`, async () => {
      const onFail = vi.fn();
      render(<OctoberPatchCanvas inputs={inputsFor(kind)} tier="full" onFail={onFail} />);
      await waitFor(() => expect((calls.drawImage ?? []).length).toBeGreaterThan(41));
      if (kind !== "board" && kind !== "reveal") {
        // Name stakes are on (they fade for the board and the reveal).
        await waitFor(() => expect((calls.fillText ?? []).length).toBeGreaterThan(0));
      }
      expect(onFail).not.toHaveBeenCalled();
    });
  }

  it("draws the still version once, without an animation loop", async () => {
    const onFail = vi.fn();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<OctoberPatchCanvas inputs={inputsFor("question")} tier="still" onFail={onFail} />);
    await waitFor(() => expect((calls.drawImage ?? []).length).toBeGreaterThan(41));
    // Every name shows in the still version, including the newest joiner's.
    const names = (calls.fillText ?? []).length;
    expect(names).toBeGreaterThan(0);
    expect(names % players.length).toBe(0); // every pass draws all 41 names
    expect(raf).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("stops and reports when drawing throws inside the animation loop", async () => {
    explodeOn = "drawImage";
    const onFail = vi.fn();
    render(<OctoberPatchCanvas inputs={inputsFor("question")} tier="full" onFail={onFail} />);
    await waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(onFail).toHaveBeenCalledTimes(1);
  });
});
