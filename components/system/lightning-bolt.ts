// Procedural lightning bolt geometry.
//
// Pure functions — given a seed, the same inputs always produce the same
// bolt. That makes the math testable in jsdom (no canvas needed) and lets
// the "subsequent strokes" of a strike re-roll just one branch while
// keeping the trunk recognizable.
//
// Algorithm:
//   1. Start with a single segment from origin → ground.
//   2. Recurse `depth` times. Each pass: split every segment at midpoint,
//      displace the midpoint perpendicular to the segment by a random
//      amount proportional to segment length.
//   3. At each split beyond a "branch threshold" depth, with `branchChance`
//      probability spawn a short branch off the midpoint at a 15-45° offset.
//      Branches recurse `branchDepthOffset` fewer levels.
//   4. Variable thickness — trunk segments are wide, branches taper to 1px
//      at their tips based on `branch.depthRemaining`.
//
// Performance notes: returns flat arrays so the canvas renderer can iterate
// without allocating per-frame. Caller is expected to call this once per
// stroke (not per frame), then redraw the stored geometry each animation
// frame as the alpha envelope evolves.

/** A single line segment in screen coordinates. */
export interface BoltSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Thickness multiplier — trunk = 1.0, branches taper to 0.2 at tip. */
  thickness: number;
  /** Depth in the recursion tree. Used by the renderer for alpha falloff. */
  depth: number;
  /** True if this segment is part of a branch (not the trunk). */
  isBranch: boolean;
}

export interface GenerateBoltOptions {
  /** Origin x in canvas pixels. */
  originX: number;
  /** Origin y in canvas pixels (where the bolt enters the screen). */
  originY: number;
  /** Target x — where the bolt "wants to end". Trunk drifts toward this. */
  targetX: number;
  /** Target y — where the bolt ends. */
  targetY: number;
  /** Recursion depth for midpoint displacement. 5-7 looks right. */
  depth?: number;
  /** Maximum perpendicular displacement, as a fraction of segment length.
   *  Larger = more jagged. 0.25 is a good starting point. */
  displacementFactor?: number;
  /** Probability of spawning a branch at each split beyond `branchAfterDepth`. */
  branchChance?: number;
  /** Don't spawn branches before this depth (keeps the trunk a single line
   *  for the first 1-2 splits). */
  branchAfterDepth?: number;
  /** Branches recurse this many fewer levels than the trunk. 1-2 looks best. */
  branchDepthOffset?: number;
  /** Hard ceiling on branches (performance + visual clarity). */
  maxBranches?: number;
  /** Seed for deterministic geometry. */
  seed?: number;
}

/**
 * Generate a full bolt — trunk plus branches — as a flat list of segments.
 * Pure: same seed + options → same output.
 */
export function generateBolt(opts: GenerateBoltOptions): BoltSegment[] {
  const {
    originX,
    originY,
    targetX,
    targetY,
    depth = 6,
    displacementFactor = 0.28,
    branchChance = 0.32,
    branchAfterDepth = 2,
    branchDepthOffset = 2,
    maxBranches = 10,
    seed = Date.now(),
  } = opts;

  const rng = mulberry32(hash32(seed));
  const segments: BoltSegment[] = [];
  const branchCounter = { count: 0 };

  subdivide(
    originX,
    originY,
    targetX,
    targetY,
    depth,
    0,
    false,
    1.0,
    depth, // depthRemaining for taper math
    segments,
    rng,
    { displacementFactor, branchChance, branchAfterDepth, branchDepthOffset, maxBranches },
    branchCounter,
  );

  return segments;
}

interface RecurseOpts {
  displacementFactor: number;
  branchChance: number;
  branchAfterDepth: number;
  branchDepthOffset: number;
  maxBranches: number;
}

function subdivide(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  depthRemaining: number,
  currentDepth: number,
  isBranch: boolean,
  trunkThickness: number,
  initialDepth: number,
  out: BoltSegment[],
  rng: () => number,
  opts: RecurseOpts,
  branchCounter: { count: number },
): void {
  if (depthRemaining <= 0) {
    // Taper toward the tip — branches thin out as their depth runs out.
    const tipFactor = isBranch ? 0.2 + 0.8 * (depthRemaining / initialDepth) : trunkThickness;
    out.push({ x1, y1, x2, y2, thickness: tipFactor, depth: currentDepth, isBranch });
    return;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);

  // Midpoint with perpendicular displacement.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Perpendicular unit vector.
  const px = -dy / (len || 1);
  const py = dx / (len || 1);
  // Random displacement in [-1, 1].
  const r = rng() * 2 - 1;
  const displacement = r * len * opts.displacementFactor;
  const newMx = mx + px * displacement;
  const newMy = my + py * displacement;

  // Recurse on the two halves.
  subdivide(
    x1, y1, newMx, newMy,
    depthRemaining - 1, currentDepth + 1, isBranch,
    trunkThickness, initialDepth,
    out, rng, opts, branchCounter,
  );
  subdivide(
    newMx, newMy, x2, y2,
    depthRemaining - 1, currentDepth + 1, isBranch,
    trunkThickness, initialDepth,
    out, rng, opts, branchCounter,
  );

  // Spawn a branch off the midpoint? Only on the trunk, and only past
  // the branch-after-depth threshold so the top isn't a hairball.
  if (
    !isBranch &&
    currentDepth >= opts.branchAfterDepth &&
    branchCounter.count < opts.maxBranches &&
    rng() < opts.branchChance
  ) {
    branchCounter.count += 1;
    // Branch angle: 15-45° off the segment direction.
    const angleOffset = (15 + rng() * 30) * (Math.PI / 180);
    const sign = rng() < 0.5 ? -1 : 1;
    // Branch length: 30-60% of remaining trunk length below the midpoint.
    const branchLen = len * (0.3 + rng() * 0.3);
    // Direction of the parent segment.
    const parentAngle = Math.atan2(dy, dx);
    const branchAngle = parentAngle + sign * angleOffset;
    const bx = newMx + Math.cos(branchAngle) * branchLen;
    const by = newMy + Math.sin(branchAngle) * branchLen;
    const branchDepth = Math.max(1, depthRemaining - opts.branchDepthOffset);
    subdivide(
      newMx, newMy, bx, by,
      branchDepth, currentDepth + 1, true,
      trunkThickness * 0.55, // branches start ~half trunk thickness
      branchDepth,
      out, rng, opts, branchCounter,
    );
  }
}

/**
 * Re-generate a bolt with the SAME trunk path but a perturbed branch set —
 * used for subsequent strokes within a multi-stage flash. The eye reads
 * "same lightning, slightly different". Implemented as a different seed:
 * the trunk midpoint displacements would change, so we just produce a
 * slightly different bolt with the same target.
 *
 * In practice this is just `generateBolt` with `seed + offset`; kept as
 * a named export for callsite readability.
 */
export function generateSubsequentStroke(opts: GenerateBoltOptions, strokeIndex: number): BoltSegment[] {
  return generateBolt({
    ...opts,
    seed: (opts.seed ?? 0) + strokeIndex * 7919, // 7919 = prime, decorrelates the PRNG
    branchChance: (opts.branchChance ?? 0.32) * 0.85, // fewer branches on later strokes
  });
}

// ─── PRNG (mulberry32 — same algorithm used elsewhere) ───────────────────
// Deterministic, fast, good enough for visual noise. Returns float in [0, 1).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a number to a 32-bit seed so non-integer / negative seeds work.
function hash32(n: number): number {
  let h = (n | 0) ^ 0x9E3779B9;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Sample an interval from an exponential distribution with given mean.
 * Used by the ambient timer for Poisson-distributed strikes — exponential
 * inter-arrival times yield a Poisson process.
 *
 * Returns milliseconds.
 */
export function sampleExponentialInterval(meanMs: number, rng: () => number = Math.random): number {
  // Inverse-CDF: -mean * ln(1 - u).
  const u = rng();
  // Guard against u=0 → -Infinity.
  return -meanMs * Math.log(1 - Math.min(u, 0.9999));
}
