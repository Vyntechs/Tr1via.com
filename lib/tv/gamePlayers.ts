import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

// The players in the game on screen. Everyone who joins the room is in
// Game 1, but Game 2 is opt-in, so the room total overstates it (Sep 24: 28
// played Game 2 in a room of 33, and the TV said "of 33"). The scores feed
// has one row per game participant; it doesn't drop players the host
// removed, so keep only those still in the room. While the feed is empty
// (the lobby), or none of its players are still here, it's the whole room.
//
// One list for every TV count and for a theme's per-player art (October's
// pumpkin patch), so the art never disagrees with the numbers on screen.
export function gamePlayers(
  snapshot: Pick<TVSnapshot, "players" | "scores">,
): TVSnapshot["players"] {
  const inGame = new Set(snapshot.scores.map((s) => s.player_key));
  const playing = snapshot.players.filter((p) => inGame.has(p.id));
  return playing.length > 0 ? playing : snapshot.players;
}

export function gamePlayerCount(
  snapshot: Pick<TVSnapshot, "players" | "scores">,
): number {
  return gamePlayers(snapshot).length;
}
