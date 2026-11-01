import { describe, expect, it } from "vitest";
import {
  TURKEY_ANIMS,
  TURKEY_STYLE,
  harvestScene,
  leaderKey,
  loopFrame,
  skyFor,
  turkeyPose,
  turkeyUrl,
} from "@/lib/experience/november/harvest";
import { tvWorldFor, hasPhoneLayer } from "@/lib/experience/packs";
import type { RowMood } from "@/lib/experience/shared/playerRow";
import type { TVMoment, TVMomentKind } from "@/lib/experience/tvMoment";

const pose = (mood: RowMood, extra: Partial<Parameters<typeof turkeyPose>[0]> = {}) =>
  turkeyPose({ mood, prevMood: mood, msSince: 5000, now: 10_000, seed: 0, leader: false, still: false, ...extra });

describe("November sky by phase", () => {
  it("is golden in the lobby and on game 1's board before its first question", () => {
    expect(skyFor({ moment: "lobby", gameNo: null, gameStarted: false })).toBe("golden");
    expect(skyFor({ moment: "lobby", gameNo: 1, gameStarted: false })).toBe("golden");
    expect(skyFor({ moment: "board", gameNo: 1, gameStarted: false })).toBe("golden");
  });
  it("is dusk through game 1", () => {
    for (const m of ["question", "reveal"] as TVMomentKind[]) {
      expect(skyFor({ moment: m, gameNo: 1, gameStarted: false })).toBe("dusk");
    }
    expect(skyFor({ moment: "board", gameNo: 1, gameStarted: true })).toBe("dusk");
    expect(skyFor({ moment: "standings", gameNo: 1, gameStarted: true })).toBe("dusk");
  });
  it("is night between games, through game 2 and at the winner", () => {
    expect(skyFor({ moment: "between-games", gameNo: 1, gameStarted: true })).toBe("night");
    for (const m of ["board", "question", "reveal", "standings"] as TVMomentKind[]) {
      expect(skyFor({ moment: m, gameNo: 2, gameStarted: true })).toBe("night");
    }
    expect(skyFor({ moment: "winner", gameNo: 1, gameStarted: true })).toBe("night");
  });
});

describe("Turkey mood mapping", () => {
  it("waiting idles with the tail down", () => {
    expect(pose("waiting").anim).toBe("idle");
  });
  it("locking in fans the tail, then holds the fanned idle", () => {
    expect(pose("lit", { prevMood: "waiting", msSince: 100 })).toEqual({ anim: "fan", frame: 1 });
    expect(pose("lit", { prevMood: "waiting", msSince: 2000 }).anim).toBe("fanned-idle");
    expect(pose("lit", { prevMood: "blaze", msSince: 100 }).anim).toBe("fanned-idle");
  });
  it("right gobbles, wrong droops, no answer hides, each holding its last frame", () => {
    expect(pose("blaze")).toEqual({ anim: "right", frame: TURKEY_ANIMS.right.frames - 1 });
    expect(pose("smoke")).toEqual({ anim: "wrong", frame: TURKEY_ANIMS.wrong.frames - 1 });
    expect(pose("toppled")).toEqual({ anim: "hide", frame: TURKEY_ANIMS.hide.frames - 1 });
    expect(pose("blaze", { prevMood: "lit", msSince: 0 }).frame).toBe(0);
  });
  it("keeps the old pose until the ripple delay is over", () => {
    expect(pose("blaze", { prevMood: "lit", msSince: -200 }).anim).toBe("fanned-idle");
  });
  it("the leader wears the gold tail", () => {
    expect(pose("lit", { leader: true }).anim).toBe("leader");
    expect(pose("blaze", { leader: true }).anim).toBe("leader");
    expect(pose("waiting", { leader: true }).anim).toBe("idle");
  });
  it("still tier: one settled frame per mood", () => {
    const still = { still: true, msSince: 0 };
    expect(pose("waiting", still)).toEqual({ anim: "idle", frame: 0 });
    expect(pose("lit", { ...still, prevMood: "waiting" })).toEqual({ anim: "fanned-idle", frame: 0 });
    expect(pose("blaze", still)).toEqual({ anim: "right", frame: 11 });
    expect(pose("smoke", still)).toEqual({ anim: "wrong", frame: 11 });
    expect(pose("toppled", still)).toEqual({ anim: "hide", frame: 9 });
    expect(pose("lit", { ...still, leader: true })).toEqual({ anim: "leader", frame: 0 });
  });
  it("turkeys don't move in step", () => {
    const frames = new Set([0, 1, 2, 3, 4, 5].map((seed) => loopFrame("idle", 5000, seed)));
    expect(frames.size).toBeGreaterThan(3);
  });
  it("swapping the look is one letter", () => {
    expect(turkeyUrl("idle")).toBe(`/themes/november/turkey/${TURKEY_STYLE}/idle-256.webp`);
  });
});

describe("Leader and scene", () => {
  const scores = [
    { player_key: "a", score: 300 },
    { player_key: "b", score: 500 },
  ];
  it("only one clear top scorer, only on the board and winner screens", () => {
    expect(leaderKey("board", scores)).toBe("b");
    expect(leaderKey("winner", scores)).toBe("b");
    expect(leaderKey("question", scores)).toBeNull();
    expect(leaderKey("board", [...scores, { player_key: "c", score: 500 }])).toBeNull();
    expect(leaderKey("board", [{ player_key: "a", score: 0 }])).toBeNull();
  });
  it("a gust in the last five seconds", () => {
    const moment: TVMoment = { kind: "question", questionId: "q", revealedAtMs: 0, serverNowMs: 0 };
    const base = { moment, players: [{ key: "a", name: "A" }], answers: [], gameNo: 1 as const, gameStarted: true, scores };
    expect(harvestScene({ ...base, secondsLeft: 3 }).gust).toBe(true);
    expect(harvestScene({ ...base, secondsLeft: 12 }).gust).toBe(false);
    expect(harvestScene({ ...base, secondsLeft: 12 }).sky).toBe("dusk");
  });
  it("November wears a world on the TV, not on phones", () => {
    expect(tvWorldFor("november")?.pack).toBe("november");
    expect(hasPhoneLayer("november")).toBe(false);
  });
});
