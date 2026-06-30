// Fires a transient celebration when the game's most-recently-finished
// picked question just cleared its category AND other categories still have
// unplayed picked questions. Drives the section-complete overlay that
// layers on top of the Jeopardy grid between sections.
//
// Two callsites:
//   • Host laptop — passes `hostAdvanced=true` once the host taps "Pick
//     next →" so the celebration plays in the picking gap, on top of the
//     grid that now serves as the canonical picker.
//   • Audience-only TV — leaves `hostAdvanced` unset; the hook waits until
//     the snapshot's sticky reveal naturally clears before firing.
//
// Never fires for the LAST category in the game — that's End Game
// territory (`canEndGame` in deriveHostMode handles the transition).
//
// The 1.8 s lifecycle is owned by the hook's internal `setTimeout`, not
// by the snapshot. Once started, the celebration plays to completion even
// if the next live question lands underneath the overlay.

"use client";

import { useEffect, useRef, useState } from "react";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

export interface SectionCompleteCelebration {
  topicName: string;
  color: string | null;
  /** The question id whose completion triggered this celebration. Used by
   *  the hook internally to dedupe re-fires for the same resolved id. */
  triggeredByQuestionId: string;
}

export const CELEBRATION_DURATION_MS = 1800;

export function useSectionCompleteCelebration(
  snapshot: TVSnapshot | null | undefined,
  hostAdvanced = false,
): SectionCompleteCelebration | null {
  const [active, setActive] = useState<SectionCompleteCelebration | null>(null);
  const celebratedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const candidate = pickCelebration(snapshot, hostAdvanced);
    if (!candidate) return;
    if (celebratedRef.current.has(candidate.triggeredByQuestionId)) return;

    celebratedRef.current.add(candidate.triggeredByQuestionId);
    setActive(candidate);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setActive(null);
      timerRef.current = null;
    }, CELEBRATION_DURATION_MS);
  }, [snapshot, hostAdvanced]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return active;
}

function pickCelebration(
  snapshot: TVSnapshot | null | undefined,
  hostAdvanced: boolean,
): SectionCompleteCelebration | null {
  if (!snapshot) return null;

  const game = snapshot.games.find((g) => g.id === snapshot.currentGameId);
  if (!game || game.state !== "live") return null;

  // Don't fire while a question is mid-play.
  const liveQuestion = snapshot.questions.find(
    (q) => q.id === snapshot.liveQuestionId,
  );
  if (liveQuestion && !liveQuestion.finishedAt) return null;

  // Sticky reveal blocks the celebration until the host has advanced (or,
  // on the audience TV, until the snapshot's resolve event clears).
  const lastResolve = snapshot.reveals.find((r) => r.event === "resolve") ?? null;
  const stickyReveal = !!lastResolve && !hostAdvanced;
  if (stickyReveal) return null;

  // Find the most-recently-finished picked question in this game.
  const catIdsInGame = new Set(
    snapshot.categories.filter((c) => c.gameId === game.id).map((c) => c.id),
  );
  const finished = snapshot.questions
    .filter(
      (q) =>
        q.isPicked &&
        q.pointValue !== null &&
        q.finishedAt !== null &&
        catIdsInGame.has(q.categoryId),
    )
    .slice()
    .sort((a, b) =>
      (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""),
    );
  const last = finished[0];
  if (!last) return null;

  // Did this question's category just clear out?
  const sameCatPicked = snapshot.questions.filter(
    (q) =>
      q.categoryId === last.categoryId &&
      q.isPicked &&
      q.pointValue !== null,
  );
  const unplayedInCat = sameCatPicked.filter((q) => q.finishedAt === null);
  if (unplayedInCat.length > 0) return null;

  // Do other categories still have unplayed picked questions? If not,
  // the game is over — defer to the End Game flow.
  const otherCatHasUnplayed = snapshot.questions.some(
    (q) =>
      q.isPicked &&
      q.pointValue !== null &&
      q.finishedAt === null &&
      catIdsInGame.has(q.categoryId) &&
      q.categoryId !== last.categoryId,
  );
  if (!otherCatHasUnplayed) return null;

  const category = snapshot.categories.find((c) => c.id === last.categoryId);
  if (!category) return null;

  return {
    topicName: category.name,
    color: category.color ?? null,
    triggeredByQuestionId: last.id,
  };
}
