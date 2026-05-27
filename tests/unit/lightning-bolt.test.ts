// Tests for the procedural bolt geometry. Pure math, no DOM needed.

import { describe, it, expect } from "vitest";
import {
  generateBolt,
  generateSubsequentStroke,
  sampleExponentialInterval,
} from "@/components/system/lightning-bolt";

describe("generateBolt", () => {
  it("is deterministic for a given seed", () => {
    const opts = { originX: 100, originY: 0, targetX: 100, targetY: 600, seed: 42 };
    const a = generateBolt(opts);
    const b = generateBolt(opts);
    expect(a).toEqual(b);
  });

  it("produces different geometry for different seeds", () => {
    const baseOpts = { originX: 100, originY: 0, targetX: 100, targetY: 600 };
    const a = generateBolt({ ...baseOpts, seed: 1 });
    const b = generateBolt({ ...baseOpts, seed: 2 });
    // Same input shape, different randomness → different segments.
    expect(a).not.toEqual(b);
  });

  it("returns at least one segment for non-zero geometry", () => {
    const out = generateBolt({ originX: 0, originY: 0, targetX: 100, targetY: 100, seed: 7 });
    expect(out.length).toBeGreaterThan(0);
  });

  it("respects maxBranches as an upper bound on branch count", () => {
    const out = generateBolt({
      originX: 50, originY: 0, targetX: 50, targetY: 800,
      seed: 99,
      depth: 7,
      branchChance: 0.95, // force branches whenever possible
      maxBranches: 3,
    });
    // Branches are the segments whose recursion was triggered from a midpoint
    // and tagged via isBranch. Count distinct branch sub-trees by the number
    // of `isBranch` segments at the SHALLOWEST branch depth (each branch
    // starts at exactly one depth in the recursion tree).
    const branchSegs = out.filter((s) => s.isBranch);
    // A branch with `branchDepth` levels produces up to 2^branchDepth tip
    // segments. With branchDepthOffset=2 (default) and recursion depth=7,
    // branches recurse 5 levels — up to 32 segments per branch. With
    // maxBranches=3, branchSegs.length is bounded.
    expect(branchSegs.length).toBeLessThanOrEqual(3 * 32);
  });

  it("first segment starts at the origin", () => {
    const out = generateBolt({ originX: 10, originY: 20, targetX: 200, targetY: 500, seed: 5 });
    expect(out[0]?.x1).toBeCloseTo(10);
    expect(out[0]?.y1).toBeCloseTo(20);
  });

  it("last (non-branch) segment ends at the target", () => {
    // Walk the trunk: the trunk segments are those with isBranch=false. The
    // last trunk segment (in depth-first order) ends at the target.
    const tx = 320;
    const ty = 800;
    const out = generateBolt({ originX: 100, originY: 0, targetX: tx, targetY: ty, seed: 31 });
    const trunk = out.filter((s) => !s.isBranch);
    const tail = trunk[trunk.length - 1];
    expect(tail?.x2).toBeCloseTo(tx);
    expect(tail?.y2).toBeCloseTo(ty);
  });

  it("segments have positive thickness", () => {
    const out = generateBolt({ originX: 0, originY: 0, targetX: 100, targetY: 500, seed: 12 });
    for (const seg of out) {
      expect(seg.thickness).toBeGreaterThan(0);
    }
  });
});

describe("generateSubsequentStroke", () => {
  it("produces different geometry than the primary bolt with same seed", () => {
    const opts = { originX: 50, originY: 0, targetX: 50, targetY: 400, seed: 17 };
    const primary = generateBolt(opts);
    const sub = generateSubsequentStroke(opts, 1);
    expect(sub).not.toEqual(primary);
  });

  it("each strokeIndex yields distinct geometry", () => {
    const opts = { originX: 50, originY: 0, targetX: 50, targetY: 400, seed: 17 };
    const a = generateSubsequentStroke(opts, 1);
    const b = generateSubsequentStroke(opts, 2);
    expect(a).not.toEqual(b);
  });
});

describe("sampleExponentialInterval", () => {
  it("returns a positive number", () => {
    let i = 0;
    const rng = () => [0.1, 0.5, 0.9, 0.01][i++ % 4]!;
    for (let n = 0; n < 10; n++) {
      const v = sampleExponentialInterval(1000, rng);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("has mean approximately equal to meanMs over many samples", () => {
    // Use Math.random across many samples — central limit kicks in fast.
    const N = 5000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += sampleExponentialInterval(1000);
    const mean = sum / N;
    // Loose tolerance — exponential has high variance. 1000 ± 200 is fine.
    expect(mean).toBeGreaterThan(800);
    expect(mean).toBeLessThan(1200);
  });

  it("clamps when rng returns near-1 so the result is finite", () => {
    const rng = () => 0.999999; // would yield -∞ without clamping
    const v = sampleExponentialInterval(100, rng);
    expect(Number.isFinite(v)).toBe(true);
  });
});
