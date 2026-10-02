// Label over the question editor on the pick screen.
//
// It used to read "EDIT QUESTION · 6 OF 20" for every question (a design-mock
// default). Now the number is the card's real position in the grid the host
// is looking at, and the total is however many cards are there (20 after a
// normal pull, 7 for a typed-in set). If the question isn't in the list, no
// number is shown.

export function editQuestionEyebrow(
  orderedIds: readonly string[],
  questionId: string,
): string {
  const index = orderedIds.indexOf(questionId);
  if (index < 0) return "EDIT QUESTION";
  return `EDIT QUESTION · ${index + 1} OF ${orderedIds.length}`;
}
