import type { GameScoreRow, GameRow, CategoryRow, QuestionRow } from "@/lib/supabase/types";

export interface StandingRow {
  /** 1-based rank within the game. */
  rank: number;
  name: string;
  score: number;
  isYou: boolean;
}

export interface Game1Standings {
  /** The top `limit` rows, ranked 1..limit. */
  top: StandingRow[];
  /** The player's own row when they rank BELOW `limit` (so the UI can pin
   *  it under the top list). null when the player is already in `top` or has
   *  no score row in this game. */
  you: StandingRow | null;
}

/**
 * Build the Game-1 leaderboard for the between-games screen from the
 * already-sorted (score desc) `game_scores` rows.
 *
 * `display_name`/`score` are nullable on the view type (it's a left-join), but
 * never null for a row that actually has a score — coalesce defensively so the
 * caller always gets a concrete string/number.
 */
export function buildGame1Standings(
  scores: GameScoreRow[],
  meId: string,
  limit = 5,
): Game1Standings {
  const ranked: StandingRow[] = scores.map((s, i) => ({
    rank: i + 1,
    name: s.display_name ?? "",
    score: s.score ?? 0,
    isYou: s.player_id === meId,
  }));
  const top = ranked.slice(0, limit);
  const meIndex = ranked.findIndex((r) => r.isYou);
  const you = meIndex >= limit ? ranked[meIndex] : null;
  return { top, you };
}

export type BetweenGamesView = "join" | "waiting" | null;

/**
 * Decide which between-games screen (if any) the player should see.
 * - "join": Game 1 done, Game 2 not done, player has NOT opted in → recap + Join CTA.
 * - "waiting": player HAS opted in and Game 2 hasn't started yet (draft/ready)
 *   → standings + "waiting for host". This is the branch that replaces the old
 *   fall-through to Game 1's last reveal (the freeze).
 * - null: anything else — let the normal lobby/question flow render. The moment
 *   Game 2 goes "live", this returns null and the phone advances on its own.
 */
export function selectBetweenGamesView(args: {
  game1State: string | null;
  game2State: string | null;
  inGame2: boolean;
}): BetweenGamesView {
  const { game1State, game2State, inGame2 } = args;
  if (game1State !== "done" || game2State === null) return null;
  if (game2State === "done") return null;
  if (!inGame2) return "join";
  if (game2State === "draft" || game2State === "ready") return "waiting";
  return null; // joined, but game 2 is live → question flow owns the screen
}

function questionBelongsToDoneGame(
  q: QuestionRow | null,
  categories: CategoryRow[],
  games: GameRow[],
): boolean {
  if (!q) return false;
  const cat = categories.find((c) => c.id === q.category_id);
  if (!cat) return false; // unknown category → can't tell, leave it alone
  const game = games.find((g) => g.id === cat.game_id);
  if (!game) return false;
  return game.state === "done";
}

/**
 * After a game ends, drop any tracked question that belongs to a game that has
 * now finished — so the previous game's reveal can't linger into the next game
 * (the flash at Game 2's start that the new "waiting" branch alone doesn't cover).
 * Scoped to done games, so it never wipes a still-live game's question.
 */
export function clearEndedGameQuestions(args: {
  games: GameRow[];
  categories: CategoryRow[];
  currentQuestion: QuestionRow | null;
  lastResolvedQuestion: QuestionRow | null;
}): { currentQuestion: QuestionRow | null; lastResolvedQuestion: QuestionRow | null } {
  const { games, categories, currentQuestion, lastResolvedQuestion } = args;
  return {
    currentQuestion: questionBelongsToDoneGame(currentQuestion, categories, games)
      ? null
      : currentQuestion,
    lastResolvedQuestion: questionBelongsToDoneGame(lastResolvedQuestion, categories, games)
      ? null
      : lastResolvedQuestion,
  };
}
