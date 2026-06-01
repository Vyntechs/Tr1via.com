import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

/** A single category shown on the TV lobby's "Tonight's Topics" panel. */
export interface LobbyTopic {
  /** Short umbrella name (e.g. "Movies") — used only for the color fallback. */
  name: string;
  /** The specific theme shown to players (e.g. "Disney Pixar Movies"). */
  topic: string;
  /** Stored category color; null falls back to categoryColor(name) at render. */
  color: string | null;
  /** Sort order within the game. */
  position: number;
}

/**
 * The game the lobby is standing by for: the current game when it's set and
 * not finished, otherwise the first not-yet-done game by number. Returns null
 * when every game is done or there are none.
 */
export function selectUpcomingGameId(snapshot: TVSnapshot): string | null {
  const current = snapshot.games.find((g) => g.id === snapshot.currentGameId) ?? null;
  if (current && current.state !== "done") return current.id;
  const upcoming = [...snapshot.games]
    .sort((a, b) => a.gameNo - b.gameNo)
    .find((g) => g.state !== "done");
  return upcoming?.id ?? null;
}

/**
 * The upcoming game's ready-to-show topics, ordered for display. Excludes any
 * category still being set up (draft/generating/review) so a half-built topic
 * never reaches the player-facing TV. Empty when there's no upcoming game or
 * none of its categories are ready — the panel then renders nothing.
 */
export function selectLobbyTopics(snapshot: TVSnapshot): LobbyTopic[] {
  const gameId = selectUpcomingGameId(snapshot);
  if (!gameId) return [];
  return snapshot.categories
    .filter((c) => c.gameId === gameId && c.state === "ready")
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ name: c.name, topic: c.topic, color: c.color, position: c.position }));
}
