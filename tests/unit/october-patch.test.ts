// October · Sleepy Hollow Night — the pumpkin patch as pure data: which
// mood each player's pumpkin shows at every moment, when the Horseman
// rides, and where every pumpkin sits for any size of room.

import { describe, expect, it } from "vitest";
import {
  PATCH_BOX,
  RIDE_LEAD_SECONDS,
  RIDE_TAIL_SECONDS,
  patchLayout,
  patchRows,
  patchScene,
  rawSecondsLeft,
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
