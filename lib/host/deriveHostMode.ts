// deriveHostMode — pure helper that maps a TVSnapshot to the host laptop's
// current "mode" (which control-strip buttons to show, whether the host can
// end the game, etc.).
//
// Mirrors the branching in TVStateMachine.tsx so the host UI flips in
// lockstep with what the audience is seeing on the inline TV panel. Kept
// pure (no React, no fetches) so HostLiveConsole + any test can call it.
//
// The `hostAdvanced` arg lets the host's "Pick next →" press during a
// sticky reveal locally override that state and surface the grid so they
// can pick the next cell — same TV the audience sees, just deliberately
// flipped to the picker.

import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

export type HostMode =
  | "loading"
  | "lobby"
  | "picking"
  | "question-live"
  | "reveal-sticky"
  | "intermission"
  | "finale";

export interface HostModeContext {
  mode: HostMode;
  /** Current game id (null in lobby/loading). */
  currentGameId: string | null;
  /** Game 1 id, when one exists. */
  game1Id: string | null;
  /** Game 2 id, when one exists. */
  game2Id: string | null;
  /** Game 1's state, for distinguishing "first game lobby" from "intermission lobby". */
  game1State: string | null;
  /** Game 2's state, for the "Start Game 2" CTA. */
  game2State: string | null;
  /** Whether the current live game's picked questions are all finished —
   *  triggers the "End Game →" CTA in picking mode (P0.33). */
  canEndGame: boolean;
}

/** Per-category row used by the section-ended picker. */
export interface RemainingTopic {
  categoryId: string;
  name: string;
  /** Category color from `categories.color` (nullable in the DB). Callers
   *  should fall back to `categoryColor(name)` when this is null. */
  color: string | null;
  /** The lowest-points unplayed picked question — what we'd auto-reveal
   *  when the host taps this topic. */
  lowestQuestionId: string;
  /** How many picked questions remain unplayed in this category. */
  remainingCount: number;
  /** Total picked questions in this category (e.g. 7). */
  totalCount: number;
}

/**
 * Returns the remaining-topics list used by the section-ended picker.
 * A "remaining" topic is a category in the given game that has at least
 * one picked question whose `finishedAt` is null. Sorted by category
 * `position` (the order the host pinned them in setup). Empty when the
 * game has no current id or no categories have unplayed questions.
 */
export function getRemainingTopics(
  snapshot: { categories: TVSnapshot["categories"]; questions: TVSnapshot["questions"] },
  gameId: string | null,
): RemainingTopic[] {
  if (!gameId) return [];
  const gameCats = snapshot.categories
    .filter((c) => c.gameId === gameId)
    .sort((a, b) => a.position - b.position);
  const out: RemainingTopic[] = [];
  for (const cat of gameCats) {
    const catQuestions = snapshot.questions.filter(
      (q) =>
        q.categoryId === cat.id &&
        q.isPicked &&
        q.pointValue !== null,
    );
    const unplayed = catQuestions.filter((q) => q.finishedAt === null);
    if (unplayed.length === 0) continue;
    const lowest = [...unplayed].sort(
      (a, b) => (a.pointValue ?? 0) - (b.pointValue ?? 0),
    )[0];
    if (!lowest) continue;
    out.push({
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      lowestQuestionId: lowest.id,
      remainingCount: unplayed.length,
      totalCount: catQuestions.length,
    });
  }
  return out;
}

export function deriveHostMode(
  snapshot: TVSnapshot | null | undefined,
  hostAdvanced = false,
): HostModeContext {
  const base: HostModeContext = {
    mode: "loading",
    currentGameId: null,
    game1Id: null,
    game2Id: null,
    game1State: null,
    game2State: null,
    canEndGame: false,
  };

  if (!snapshot) return base;

  const game1 = snapshot.games.find((g) => g.gameNo === 1) ?? null;
  const game2 = snapshot.games.find((g) => g.gameNo === 2) ?? null;
  const currentGame =
    snapshot.games.find((g) => g.id === snapshot.currentGameId) ?? null;

  const ctx: HostModeContext = {
    ...base,
    currentGameId: currentGame?.id ?? null,
    game1Id: game1?.id ?? null,
    game2Id: game2?.id ?? null,
    game1State: game1?.state ?? null,
    game2State: game2?.state ?? null,
  };

  const nightClosed = snapshot.night.closedAt !== null;
  const isFinale =
    nightClosed ||
    game2?.state === "done" ||
    (game1?.state === "done" && !game2);
  const intermission =
    game1?.state === "done" &&
    !!game2 &&
    game2.state !== "done" &&
    !isFinale;

  if (isFinale) return { ...ctx, mode: "finale" };

  if (!currentGame || currentGame.state === "draft" || currentGame.state === "ready") {
    if (intermission) return { ...ctx, mode: "intermission" };
    return { ...ctx, mode: "lobby" };
  }

  if (currentGame.state === "done") {
    if (intermission) return { ...ctx, mode: "intermission" };
    return { ...ctx, mode: "finale" };
  }

  // currentGame.state === 'live'
  const liveQuestion = snapshot.questions.find(
    (q) => q.id === snapshot.liveQuestionId,
  );
  if (liveQuestion && !liveQuestion.finishedAt) {
    return { ...ctx, mode: "question-live" };
  }

  const lastResolve =
    snapshot.reveals.find((r) => r.event === "resolve") ?? null;
  if (lastResolve && !hostAdvanced) {
    return { ...ctx, mode: "reveal-sticky" };
  }

  // Picking mode — compute "all picked questions in this game finished"
  // for the End Game CTA.
  const catIdsInGame = new Set(
    snapshot.categories
      .filter((c) => c.gameId === currentGame.id)
      .map((c) => c.id),
  );
  const pickedInGame = snapshot.questions.filter(
    (q) =>
      q.isPicked &&
      q.pointValue !== null &&
      catIdsInGame.has(q.categoryId),
  );
  const canEndGame =
    pickedInGame.length > 0 && pickedInGame.every((q) => q.finishedAt !== null);

  return { ...ctx, mode: "picking", canEndGame };
}
