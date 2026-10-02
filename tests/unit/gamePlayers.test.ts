// The players in the game on screen: one list for every TV count and for
// October's pumpkin patch, so the two never disagree.
import { describe, expect, it } from "vitest";
import { gamePlayerCount, gamePlayers } from "@/lib/tv/gamePlayers";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

type P = TVSnapshot["players"][number];
type S = TVSnapshot["scores"][number];
const player = (id: string): P => ({ id, displayName: id, joinedAt: "2026-10-07T23:00:00Z" }) as unknown as P;
const score = (player_key: string): S =>
  ({ player_key, display_name: player_key, score: 0, correct_count: 0, answered_count: 0, fastest_correct_ms: null }) as S;

const room = ["a", "b", "c", "d", "e"].map(player);

describe("gamePlayers", () => {
  it("is the whole room before any game has scores (the lobby)", () => {
    expect(gamePlayers({ players: room, scores: [] }).map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(gamePlayerCount({ players: room, scores: [] })).toBe(5);
  });

  it("is only this game's players once the game has scores (Game 2 is opt-in)", () => {
    const scores = ["a", "c", "e"].map(score);
    expect(gamePlayers({ players: room, scores }).map((p) => p.id)).toEqual(["a", "c", "e"]);
    expect(gamePlayerCount({ players: room, scores })).toBe(3);
  });

  it("leaves out a player the host removed (their score row lingers)", () => {
    const scores = ["a", "c", "e"].map(score);
    const players = room.filter((p) => p.id !== "c");
    expect(gamePlayers({ players, scores }).map((p) => p.id)).toEqual(["a", "e"]);
    expect(gamePlayerCount({ players, scores })).toBe(2);
  });

  it("falls back to the room when none of the game's players are still here", () => {
    const scores = ["x", "y"].map(score);
    expect(gamePlayerCount({ players: room, scores })).toBe(5);
  });
});
