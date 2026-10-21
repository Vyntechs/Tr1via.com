// Shuffle a question's four answer choices before it is saved.
//
// Why: the AI writer tends to put the right answer first (measured Oct 2026:
// Sonnet 5.5 keyed the right answer as choice A on ~96% of questions). Phones
// already scramble per player (lib/game/scramble.ts), but the TV shows the
// stored order, so a regular could learn "it's always A". Shuffling once at
// save time fixes the stored order for every screen; the per-player scramble
// on top is unchanged.
//
// Pure math, no `server-only`, so tests and scripts can import it.

export type ChoiceIndex = 0 | 1 | 2 | 3;
export type ChoiceOrder = [ChoiceIndex, ChoiceIndex, ChoiceIndex, ChoiceIndex];

export interface ShuffleableQuestion {
  options: [string, string, string, string];
  correctIndex: ChoiceIndex;
}

/**
 * A uniformly random permutation of [0,1,2,3] (Fisher-Yates). `random` is
 * injectable so tests can pin the result; production uses Math.random (this
 * is display order, not a secret).
 */
export function randomChoiceOrder(random: () => number = Math.random): ChoiceOrder {
  const order: ChoiceIndex[] = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order as ChoiceOrder;
}

/**
 * Returns a copy of `question` with its options reordered and `correctIndex`
 * moved along with the right answer, so the marked answer text never changes.
 */
export function shuffleChoices<T extends ShuffleableQuestion>(
  question: T,
  random: () => number = Math.random,
): T {
  const order = randomChoiceOrder(random);
  const options = order.map((i) => question.options[i]) as [string, string, string, string];
  const correctIndex = order.indexOf(question.correctIndex) as ChoiceIndex;
  return { ...question, options, correctIndex };
}
