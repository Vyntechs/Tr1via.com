import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";

/** A single category shown on the lobby's "Tonight's Topics" panel — used by
 *  both the venue TV (TVLobby) and the player phone (PlayerLobby). */
export interface LobbyTopic {
  /** The player-facing display string: the host's clean category name
   *  (categories.name, e.g. "Pest"), falling back to the generation topic only
   *  when the name is blank. THIS is what every lobby surface renders — never
   *  the raw `topic`. Resolved once via lobbyTopicLabel() so the surfaces can't
   *  drift on which field to show. */
  label: string;
  /** The host's short clean category name (categories.name, e.g. "Pest").
   *  Drives the color fallback (categoryColor) and is the source of `label`. */
  name: string;
  /** The instruction the host gave the AI to generate this category's questions
   *  (categories.topic, e.g. "Pest like mosquitoes and flies, also children in
   *  movies"). Generation input — NOT shown to players. */
  topic: string;
  /** Stored category color; null falls back to categoryColor(name) at render. */
  color: string | null;
  /** Sort order within the game. */
  position: number;
}

/** The player-facing label for a category: its clean name, falling back to the
 *  generation topic only when the name is blank. Centralized so the TV, player
 *  phone, and host-mirrored console surfaces can't drift on which field to show. */
export function lobbyTopicLabel(name: string, topic: string): string {
  const clean = (name ?? "").trim();
  return clean.length > 0 ? clean : topic;
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
    .map((c) => ({
      label: lobbyTopicLabel(c.name, c.topic),
      name: c.name,
      topic: c.topic,
      color: c.color,
      position: c.position,
    }));
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
