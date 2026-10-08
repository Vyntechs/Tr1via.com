// October · Sleepy Hollow Night — the pumpkin patch as pure data: which
// mood each player's pumpkin shows at every moment, when the Horseman
// rides, and where every pumpkin sits for any size of room.

import { describe, expect, it } from "vitest";
import {
  HEADSTONE_ART,
  HEADSTONE_SPOTS,
  PATCH_BOX,
  RIDE_LEAD_SECONDS,
  RIDE_TAIL_SECONDS,
  headstoneSpots,
  nextHeadstoneTier,
  patchLayout,
  patchRows,
  patchScene,
  rawSecondsLeft,
  type HeadstoneStyle,
  type HeadstoneTier,
  type PatchAnswer,
  type PatchPlayer,
} from "@/lib/experience/october/patch";
import type { TVMoment } from "@/lib/experience/tvMoment";

const players: PatchPlayer[] = [
  { key: "a", name: "Coach K" },
  { key: "b", name: "Smarty Pints" },
  { key: "c", name: "Two Brews" },
];
const Q = "q-subway-100";
const REVEALED = 1_000_000;

const question = (): TVMoment => ({ kind: "question", questionId: Q, revealedAtMs: REVEALED, serverNowMs: REVEALED });
const reveal = (): TVMoment => ({ kind: "reveal", questionId: Q, revealedAtMs: null, serverNowMs: null });
const plain = (kind: TVMoment["kind"]): TVMoment => ({ kind, questionId: null, revealedAtMs: null, serverNowMs: null });
const at = (secondsLeft: number) => REVEALED + (25 - secondsLeft) * 1000;

const lockedA: PatchAnswer[] = [{ playerKey: "a", questionId: Q, isCorrect: null }];

describe("patchScene · moods", () => {
  it("lobby, board, standings and between games: the whole patch glows", () => {
    for (const kind of ["lobby", "board", "standings", "between-games"] as const) {
      const scene = patchScene({ moment: plain(kind), players, answers: [], serverNowMs: 0 });
      expect(scene.phase).toBe("calm");
      expect(Object.values(scene.moods)).toEqual(["lit", "lit", "lit"]);
    }
  });

  it("question up: unlit until you lock in, then lit", () => {
    const scene = patchScene({ moment: question(), players, answers: lockedA, serverNowMs: at(14) });
    expect(scene.phase).toBe("asking");
    expect(scene.moods).toEqual({ a: "lit", b: "waiting", c: "waiting" });
    expect(scene.shiver).toBe(false);
    expect(scene.clouds).toBe(false);
  });

  it("ignores answers to a different question", () => {
    const other: PatchAnswer[] = [{ playerKey: "b", questionId: "q-old", isCorrect: true }];
    const scene = patchScene({ moment: question(), players, answers: other, serverNowMs: at(14) });
    expect(scene.moods.b).toBe("waiting");
  });

  it("last five seconds: unlit pumpkins shiver and clouds cover the moon", () => {
    const scene = patchScene({ moment: question(), players, answers: lockedA, serverNowMs: at(4.5) });
    expect(scene.phase).toBe("final-seconds");
    expect(scene.shiver).toBe(true);
    expect(scene.clouds).toBe(true);
  });

  it("time's up: no one is knocked over until the reveal brings every answer", () => {
    // The venue TV's answer list can lag a few seconds; a buzzer-beater must
    // never be shown knocked over with their name on the stake.
    const scene = patchScene({ moment: question(), players, answers: lockedA, serverNowMs: at(-0.2) });
    expect(scene.phase).toBe("times-up");
    expect(scene.moods).toEqual({ a: "lit", b: "waiting", c: "waiting" });
    expect(scene.shiver).toBe(false);
    // Names fade as answers close, before anything blazes, smokes or tips.
    expect(scene.showNames).toBe(false);
  });

  it("reveal: right blazes, wrong smokes, missed stays knocked over, names fade", () => {
    const answers: PatchAnswer[] = [
      { playerKey: "a", questionId: Q, isCorrect: true },
      { playerKey: "b", questionId: Q, isCorrect: false },
    ];
    const scene = patchScene({ moment: reveal(), players, answers, serverNowMs: 0 });
    expect(scene.moods).toEqual({ a: "blaze", b: "smoke", c: "toppled" });
    expect(scene.showNames).toBe(false);
  });

  it("names show everywhere except the board and the reveal", () => {
    expect(patchScene({ moment: plain("lobby"), players, answers: [], serverNowMs: 0 }).showNames).toBe(true);
    expect(patchScene({ moment: plain("board"), players, answers: [], serverNowMs: 0 }).showNames).toBe(false);
    expect(patchScene({ moment: question(), players, answers: [], serverNowMs: at(10) }).showNames).toBe(true);
    expect(patchScene({ moment: plain("winner"), players, answers: [], serverNowMs: 0 }).showNames).toBe(true);
  });

  it("winner: the whole patch blazes", () => {
    const scene = patchScene({ moment: plain("winner"), players, answers: [], serverNowMs: 0 });
    expect(Object.values(scene.moods)).toEqual(["blaze", "blaze", "blaze"]);
  });
});

describe("patchScene · the Headless Horseman", () => {
  it("waits on the far ridge in the last seconds, then rides as answers close", () => {
    const ridge = patchScene({ moment: question(), players, answers: [], serverNowMs: at(RIDE_LEAD_SECONDS + 1) });
    expect(ridge.horseman).toBe("ridge");
    const ride = patchScene({ moment: question(), players, answers: [], serverNowMs: at(RIDE_LEAD_SECONDS - 0.1) });
    expect(ride.horseman).toBe("ride");
    const atZero = patchScene({ moment: question(), players, answers: [], serverNowMs: at(0) });
    expect(atZero.horseman).toBe("ride");
    const gone = patchScene({ moment: question(), players, answers: [], serverNowMs: at(-RIDE_TAIL_SECONDS - 0.1) });
    expect(gone.horseman).toBe("none");
  });

  it("stays away while there's plenty of time", () => {
    expect(patchScene({ moment: question(), players, answers: [], serverNowMs: at(12) }).horseman).toBe("none");
  });

  it("finishes his ride across the switch to the reveal", () => {
    const scene = patchScene({
      moment: reveal(),
      questionClock: { questionId: Q, revealedAtMs: REVEALED, endedAtMs: at(-0.6) },
      players,
      answers: [],
      serverNowMs: at(-0.8),
    });
    expect(scene.phase).toBe("reveal");
    expect(scene.horseman).toBe("ride");
  });

  it("never rides when the reveal comes before his ride would start", () => {
    const clock = { questionId: Q, revealedAtMs: REVEALED, endedAtMs: at(12) };
    for (const left of [11, 5, 1, 0, -0.5]) {
      const scene = patchScene({ moment: reveal(), questionClock: clock, players, answers: [], serverNowMs: at(left) });
      expect(scene.horseman).toBe("none");
    }
  });

  it("waits by the moon between games and rears on the ridge for the winner", () => {
    expect(patchScene({ moment: plain("between-games"), players, answers: [], serverNowMs: 0 }).horseman).toBe("bridge");
    expect(patchScene({ moment: plain("winner"), players, answers: [], serverNowMs: 0 }).horseman).toBe("rear");
  });
});

describe("the moon", () => {
  it("rises behind the patch, brighter while a question is up", () => {
    expect(patchScene({ moment: question(), players, answers: [], serverNowMs: at(10) }).moon).toBe("question");
    expect(patchScene({ moment: plain("winner"), players, answers: [], serverNowMs: 0 }).moon).toBe("winner");
  });
});

describe("rawSecondsLeft", () => {
  it("counts down from 25 and keeps going below zero", () => {
    expect(rawSecondsLeft(REVEALED, REVEALED)).toBe(25);
    expect(rawSecondsLeft(REVEALED, REVEALED + 26_000)).toBe(-1);
    expect(rawSecondsLeft(null, REVEALED)).toBeNull();
  });
});

describe("patchLayout", () => {
  it("matches the design for 29 players: 14 behind, 15 in front, on a 99.2px step", () => {
    expect(patchRows(29)).toEqual([14, 15]);
    const slots = patchLayout(29);
    const front = slots.filter((s) => s.row === 1);
    expect(front).toHaveLength(15);
    expect(front[1].cx - front[0].cx).toBeCloseTo(99.2, 1);
    expect(front[0].w).toBeCloseTo(124, 0);
  });

  it("fits the 41-player record in two rows", () => {
    expect(patchRows(41)).toEqual([20, 21]);
  });

  it("adds a third row past 44 so names stay readable", () => {
    expect(patchRows(44)).toHaveLength(2);
    expect(patchRows(45)).toHaveLength(3);
    expect(patchRows(65)).toEqual([21, 22, 22]);
  });

  it("keeps every pumpkin inside the patch strip for any size of room", () => {
    for (const n of [1, 2, 5, 12, 29, 41, 44, 45, 52, 65, 80]) {
      const slots = patchLayout(n);
      expect(slots).toHaveLength(n);
      for (const s of slots) {
        expect(s.cx).toBeGreaterThanOrEqual(PATCH_BOX.x);
        expect(s.cx).toBeLessThanOrEqual(PATCH_BOX.x + PATCH_BOX.w);
        expect(s.top).toBeGreaterThanOrEqual(PATCH_BOX.y - 1);
        expect(s.stakeTop + s.stakeH).toBeLessThanOrEqual(900);
      }
    }
  });

  it("never grows past the design size for small rooms", () => {
    const one = patchLayout(1)[0];
    expect(one.w).toBeCloseTo(124, 0);
    expect(one.cx).toBeCloseTo(PATCH_BOX.x + PATCH_BOX.w / 2, 5);
  });

  it("is empty for an empty room", () => {
    expect(patchLayout(0)).toEqual([]);
  });
});

// ─── headstones ──────────────────────────────────────────────────────────

const TIER_NAMES: HeadstoneTier[] = ["three", "pair", "corners", "none"];

/** Fills a lobby up (or empties it) one player at a time and records each
 *  time the tier changes. */
function walk(counts: number[], start: HeadstoneTier | null = null) {
  let tier = start;
  const changes: Array<{ at: number; tier: HeadstoneTier }> = [];
  for (const c of counts) {
    const next = nextHeadstoneTier(tier, c);
    if (next !== tier) changes.push({ at: c, tier: next });
    tier = next;
  }
  return changes;
}
const range = (from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (to >= from ? from + i : from - i));

describe("headstones · which stones show", () => {
  it("fresh look: three stones up to 16, a pair to 24, corners to 44, none past that", () => {
    const at = (n: number) => nextHeadstoneTier(null, n);
    expect([0, 8, 13, 16].map(at)).toEqual(["three", "three", "three", "three"]);
    expect([17, 21, 24].map(at)).toEqual(["pair", "pair", "pair"]);
    expect([25, 29, 41, 44].map(at)).toEqual(["corners", "corners", "corners", "corners"]);
    expect([45, 80, 150].map(at)).toEqual(["none", "none", "none"]);
  });

  it("names the stones in each tier: slab left, mossy right, small cross beside the slab", () => {
    expect(headstoneSpots("three").map((s) => [s.id, s.style])).toEqual([
      ["left", "slab"],
      ["right", "mossy"],
      ["extra", "cross"],
    ]);
    expect(headstoneSpots("pair").map((s) => s.style)).toEqual(["slab", "mossy"]);
    expect(headstoneSpots("corners").map((s) => [s.id, s.style, s.scale])).toEqual([
      ["corner-left", "slab", 0.4],
      ["corner-right", "cross", 0.4],
    ]);
    expect(headstoneSpots("none")).toEqual([]);
  });

  it("uses the Figma prototype's fixed spots", () => {
    const spot = (id: string) => HEADSTONE_SPOTS.find((s) => s.id === id)!;
    expect([spot("left").x, spot("left").top, spot("left").scale]).toEqual([36, 692, 1]);
    expect([spot("right").x, spot("right").top, spot("right").scale]).toEqual([1416, 692, 1]);
    expect([spot("extra").x, spot("extra").top, spot("extra").scale]).toEqual([175.2, 719.2, 0.8]);
    // The corner stones differ from the prototype (0.4x, tucked in): see the note in patch.ts.
    expect([spot("corner-left").x, spot("corner-left").top, spot("corner-left").scale]).toEqual([0, 686, 0.4]);
    expect([spot("corner-right").x, spot("corner-right").top, spot("corner-right").scale]).toEqual([1536, 686, 0.4]);
  });

  it("is the same answer for the same input, and never reads a clock", () => {
    for (const prev of [null, ...TIER_NAMES]) {
      for (const n of [0, 16, 17, 24, 25, 44, 45]) {
        expect(nextHeadstoneTier(prev, n)).toBe(nextHeadstoneTier(prev, n));
      }
    }
  });

  it("copes with a bad count (NaN, negative, huge, fractional)", () => {
    expect(nextHeadstoneTier(null, Number.NaN)).toBe("three");
    expect(nextHeadstoneTier(null, -5)).toBe("three");
    expect(nextHeadstoneTier("pair", Number.POSITIVE_INFINITY)).toBe("three");
    expect(nextHeadstoneTier(null, 1e9)).toBe("none");
    expect(nextHeadstoneTier(null, 24.9)).toBe("pair");
  });
});

describe("headstones · no jumping", () => {
  it("a lobby filling from 0 to 30 changes the stones exactly twice (cross leaves at 17, pair shrinks at 25)", () => {
    const changes = walk(range(0, 30), null).slice(1); // the first look is not a change
    expect(changes).toEqual([
      { at: 17, tier: "pair" },
      { at: 25, tier: "corners" },
    ]);
  });

  it("bouncing between 24 and 25 changes the stones once, not every time", () => {
    const changes = walk([24, 25, 24, 25, 24, 25, 23, 25, 24], "pair");
    expect(changes).toEqual([{ at: 25, tier: "corners" }]);
  });

  it("the big stones come back only at 22 or fewer", () => {
    expect(nextHeadstoneTier("corners", 23)).toBe("corners");
    expect(nextHeadstoneTier("corners", 22)).toBe("pair");
  });

  it("the cross comes back only at 14 or fewer", () => {
    expect(nextHeadstoneTier("pair", 16)).toBe("pair");
    expect(nextHeadstoneTier("pair", 15)).toBe("pair");
    expect(nextHeadstoneTier("pair", 14)).toBe("three");
    expect(nextHeadstoneTier("three", 16)).toBe("three");
    expect(nextHeadstoneTier("three", 17)).toBe("pair");
  });

  it("the corner stones step aside at 45 and come back at 43 or fewer", () => {
    expect(nextHeadstoneTier("corners", 44)).toBe("corners");
    expect(nextHeadstoneTier("corners", 45)).toBe("none");
    expect(nextHeadstoneTier("none", 44)).toBe("none");
    expect(nextHeadstoneTier("none", 43)).toBe("corners");
  });

  it("a big jump settles in one step (a crowd leaves at once)", () => {
    expect(nextHeadstoneTier("corners", 10)).toBe("three");
    expect(nextHeadstoneTier("none", 10)).toBe("three");
    expect(nextHeadstoneTier("three", 30)).toBe("corners");
    expect(nextHeadstoneTier("three", 100)).toBe("none");
  });

  it("emptying a full night walks the stones back through each tier once", () => {
    const changes = walk(range(46, 0), "none");
    expect(changes.map((c) => c.tier)).toEqual(["corners", "pair", "three"]);
    expect(changes.map((c) => c.at)).toEqual([43, 22, 14]);
  });
});

// ─── headstones never touch a pumpkin, a name tag or the stage edge ──────

/** Where each style's visible stone sits inside its 160×200 art box
 *  (generous: includes the grass tufts and the cracked corner). */
const VISIBLE: Record<HeadstoneStyle, { x0: number; x1: number; y0: number; y1: number }> = {
  slab: { x0: 20, x1: 128, y0: 36, y1: 195 },
  cross: { x0: 44, x1: 116, y0: 28, y1: 195 },
  mossy: { x0: 10, x1: 148, y0: 46, y1: 195 },
};

/** Gap in stage px between a stone and the nearest pumpkin body or name stake
 *  (negative = overlap). A pumpkin's body spans 44% either side of centre and
 *  starts 28% down its art box (measured from the art). */
function nearestGap(tier: HeadstoneTier, count: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const spot of headstoneSpots(tier)) {
    const v = VISIBLE[spot.style];
    const stone = {
      x0: spot.x + v.x0 * spot.scale,
      x1: spot.x + v.x1 * spot.scale,
      y0: spot.top + v.y0 * spot.scale,
      y1: spot.top + v.y1 * spot.scale,
    };
    for (const p of patchLayout(count)) {
      const parts = [
        { x0: p.cx - 0.44 * p.w, x1: p.cx + 0.44 * p.w, y0: p.top + 0.28 * p.h, y1: p.top + p.h },
        { x0: p.cx - p.stakeMaxW / 2, x1: p.cx + p.stakeMaxW / 2, y0: p.stakeTop, y1: p.stakeTop + p.stakeH },
      ];
      for (const r of parts) {
        const dx = Math.max(r.x0 - stone.x1, stone.x0 - r.x1);
        const dy = Math.max(r.y0 - stone.y1, stone.y0 - r.y1);
        worst = Math.min(worst, Math.max(dx, dy));
      }
    }
  }
  return worst;
}

describe("headstones · stay clear of the patch", () => {
  it("every stone stands inside the 1600×900 stage", () => {
    for (const spot of HEADSTONE_SPOTS) {
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.top).toBeGreaterThanOrEqual(0);
      expect(spot.x + HEADSTONE_ART.w * spot.scale).toBeLessThanOrEqual(1600);
      expect(spot.top + HEADSTONE_ART.h * spot.scale).toBeLessThanOrEqual(900);
    }
  });

  it("for every size of room 0 to 150, whatever tier the rule can be holding there clears every pumpkin and name stake", () => {
    // Any tier can be showing when the count changes, so try every
    // previous tier at every count and keep what the rule lands on.
    for (let count = 0; count <= 150; count++) {
      const held = new Set(TIER_NAMES.map((prev) => nextHeadstoneTier(prev, count)));
      held.add(nextHeadstoneTier(null, count));
      for (const tier of held) {
        expect(nearestGap(tier, count), `${tier} at ${count} players`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("the two corner stones stay small and above the end pumpkins at the 41-player record", () => {
    expect(nextHeadstoneTier(null, 41)).toBe("corners");
    expect(nearestGap("corners", 41)).toBeGreaterThanOrEqual(8);
  });

  it("the full-size spots do not depend on the count (people joining never push them around)", () => {
    const pair = headstoneSpots("pair");
    // The same two spots at every count from 17 to 24, and in the "three" tier.
    for (let n = 17; n <= 24; n++) expect(headstoneSpots(nextHeadstoneTier(null, n))).toEqual(pair);
    expect(headstoneSpots("three").slice(0, 2)).toEqual(pair);
  });
});
