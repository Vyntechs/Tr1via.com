import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";

/** A single category shown on the lobby's "Tonight's Topics" panel — used by
 *  both the venue TV (TVLobby) and the player phone (PlayerLobby). */
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

// The minimal shapes the selection core needs. Both snapshot flavors (the
// TV's camelCase TVSnapshot and the player's raw-row RoomSnapshot) adapt to
// these so the "which game's topics, and which are ready" logic lives in one
// place and can't drift between the two surfaces.
interface LobbyGame {
  id: string;
  gameNo: number;
  state: string;
}
interface LobbyCategory {
  gameId: string;
  state: string;
  name: string;
  topic: string;
  color: string | null;
  position: number;
}

/**
 * The game the lobby is standing by for: the current game when it's set and
 * not finished, otherwise the first not-yet-done game by number. Returns null
 * when every game is done or there are none.
 */
function pickUpcomingGameId(games: LobbyGame[], currentGameId: string | null): string | null {
  const current = games.find((g) => g.id === currentGameId) ?? null;
  if (current && current.state !== "done") return current.id;
  const upcoming = [...games]
    .sort((a, b) => a.gameNo - b.gameNo)
    .find((g) => g.state !== "done");
  return upcoming?.id ?? null;
}

/**
 * The upcoming game's ready-to-show topics, ordered for display. Excludes any
 * category still being set up (draft/generating/review) so a half-built topic
 * never reaches a player-facing surface. Empty when there's no upcoming game
 * or none of its categories are ready — the panel then renders nothing.
 */
function pickLobbyTopics(
  games: LobbyGame[],
  categories: LobbyCategory[],
  currentGameId: string | null,
): LobbyTopic[] {
  const gameId = pickUpcomingGameId(games, currentGameId);
  if (!gameId) return [];
  return categories
    .filter((c) => c.gameId === gameId && c.state === "ready")
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ name: c.name, topic: c.topic, color: c.color, position: c.position }));
}

/** TV surface: the upcoming game id from the camelCase TV snapshot. */
export function selectUpcomingGameId(snapshot: TVSnapshot): string | null {
  return pickUpcomingGameId(snapshot.games, snapshot.currentGameId);
}

/** TV surface: the upcoming game's ready topics from the TV snapshot. */
export function selectLobbyTopics(snapshot: TVSnapshot): LobbyTopic[] {
  return pickLobbyTopics(snapshot.games, snapshot.categories, snapshot.currentGameId);
}

/**
 * Player surface: the upcoming game's ready topics from the player room
 * snapshot. The room snapshot carries raw DB rows (snake_case), so adapt
 * them to the shared core. `currentGame` is the live game (or most recent
 * done); in the pre-game lobby it's null, so the core falls through to
 * game 1 — exactly the game players are waiting to see.
 */
export function selectLobbyTopicsFromRoom(snapshot: RoomSnapshot): LobbyTopic[] {
  const games = snapshot.games.map((g) => ({ id: g.id, gameNo: g.game_no, state: g.state }));
  const categories = snapshot.categories.map((c) => ({
    gameId: c.game_id,
    state: c.state,
    name: c.name,
    topic: c.topic,
    color: c.color,
    position: c.position,
  }));
  return pickLobbyTopics(games, categories, snapshot.currentGame?.id ?? null);
}
