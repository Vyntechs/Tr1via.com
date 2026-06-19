import type { AnswerRow } from "@/lib/supabase/types";
import type { FireworksBeat } from "@/components/system/PyrotechnicsBeatConductor";

export function playerWasCorrect(
  myAnswer: AnswerRow | null,
  correctIndex: number | null | undefined,
): boolean {
  if (!myAnswer || typeof correctIndex !== "number") return false;
  return myAnswer.is_correct === true || myAnswer.chosen_index === correctIndex;
}

/**
 * Gate a firework beat for ONE player's phone: a `finale` fires for everyone
 * (whole-room game-end eruption); a `salvo` fires only for the player who got
 * the question right (fireworks are earned). Returns the beat to publish, or
 * null to stay calm.
 *
 * `resolvedQuestionId` is the question `amCorrect` was computed for. A salvo
 * fires only when the beat's own `questionId` matches it — closing a
 * cross-question race: the beat arrives synchronously but `amCorrect` lags one
 * question behind until the post-resolve refetch lands, so without this binding
 * a salvo could briefly fire using the PRIOR question's correctness. When the
 * ids disagree the gate holds (null) and re-fires once the refetch makes them
 * agree (still before fireAt). A salvo without a questionId falls back to
 * `amCorrect` alone.
 */
export function gateBeatForPlayer(
  beat: FireworksBeat | null,
  amCorrect: boolean,
  resolvedQuestionId?: string | null,
): FireworksBeat | null {
  if (!beat) return null;
  if (beat.kind === "finale") return beat;
  if (!amCorrect) return null;
  if (beat.questionId && beat.questionId !== resolvedQuestionId) return null;
  return beat;
}
