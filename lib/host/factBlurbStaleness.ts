// When does a question's fun fact stop being true?
//
// The fun fact is the line the host reads aloud the moment the answer is
// revealed. It is written ABOUT a specific question, so rewriting the
// question silently invalidates it. On 2026-07-29 that put a 5-12-13
// Pythagorean-triple fact under "The square root of 900 is:" — live, read to
// the room, because the edit panel never touched fact_blurb (issue #173).
//
// These two predicates decide whether the host's save should trigger an
// automatic rewrite. Kept pure and separate from the pick screen so the rule
// is testable on its own — it is the part that has to be right.

/** The subset of an edit that can invalidate a fun fact. */
export interface FactBlurbSubject {
  prompt: string;
  options: readonly string[];
  correctIndex: number;
}

/**
 * Did this edit change what the question ASKS or which answer is correct?
 *
 * Deliberately narrow. Moving a question to a different point value, swapping
 * its photo, or fixing a typo's surrounding whitespace leaves the fun fact
 * perfectly valid — rewriting it then would burn a model call and could
 * replace a good fact with a worse one.
 */
export function questionMeaningChanged(
  next: FactBlurbSubject,
  before: FactBlurbSubject,
): boolean {
  if (next.prompt.trim() !== before.prompt.trim()) return true;
  if (next.correctIndex !== before.correctIndex) return true;
  return next.options.some(
    (option, i) => option.trim() !== (before.options[i] ?? "").trim(),
  );
}

/**
 * Should we rewrite the fun fact as part of this save?
 *
 * Yes when the question's meaning changed AND the host left the fact alone.
 * No when she typed her own — her words always win; she is the one who has to
 * say it out loud. Also no when the question is unchanged, so a host who is
 * only re-slotting point values never waits on a model call.
 */
export function shouldRewriteFactBlurb(args: {
  next: FactBlurbSubject & { factBlurb: string };
  before: FactBlurbSubject & { factBlurb: string | null };
}): boolean {
  const { next, before } = args;
  const hostTypedHerOwn =
    next.factBlurb.trim() !== (before.factBlurb ?? "").trim();
  if (hostTypedHerOwn) return false;
  return questionMeaningChanged(next, before);
}
