// What's wrong with the four answers in the host's question editor, if
// anything, in words the host can act on.
//
// The save route refuses a question whose answers are blank or repeat each
// other (lib/api/schemas.ts QuestionOptionsTupleSchema: trimmed, non-empty,
// distinct ignoring case). Before this, the editor let the host press Save or
// "Rewrite to match" anyway and she got the route's raw message — "options
// must be four distinct values" — in a toast, with no hint which rows were
// the problem. This mirrors that rule exactly so the editor can point at the
// rows before anything is sent.
//
// Pure, no React, so tests and the pick screen can share it.

/** The same comparison the save route makes: trim, then ignore case. */
function answerKey(value: string): string {
  return value.trim().toLowerCase();
}

export interface AnswerChoiceProblem {
  /** Zero-based rows to outline. */
  rows: number[];
  /** One plain sentence for the host. */
  message: string;
}

/** "1", "1 and 2", "1, 2 and 3" — answer numbers as the host sees them. */
function listNumbers(rows: number[]): string {
  const nums = rows.map((r) => String(r + 1));
  if (nums.length <= 1) return nums.join("");
  return `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
}

/**
 * Returns null when the four answers would save, otherwise the rows to flag
 * and what to tell the host. Blank answers are reported before repeats,
 * because a blank row is the more obvious thing to fix first.
 */
export function findAnswerChoiceProblem(
  options: readonly string[],
): AnswerChoiceProblem | null {
  const blank = options
    .map((o, i) => (answerKey(o) === "" ? i : -1))
    .filter((i) => i >= 0);
  if (blank.length > 0) {
    return {
      rows: blank,
      message:
        blank.length === 1
          ? `Answer ${listNumbers(blank)} is empty. Fill in all four answers.`
          : `Answers ${listNumbers(blank)} are empty. Fill in all four answers.`,
    };
  }

  // First repeated group only: one clear instruction beats a list.
  for (let i = 0; i < options.length; i++) {
    const key = answerKey(options[i]!);
    const group = options
      .map((o, j) => (answerKey(o) === key ? j : -1))
      .filter((j) => j >= 0);
    if (group.length > 1) {
      return {
        rows: group,
        message:
          group.length === 2
            ? `Answers ${listNumbers(group)} are the same. Change one so all four are different.`
            : `Answers ${listNumbers(group)} are the same. Change them so all four are different.`,
      };
    }
  }
  return null;
}

/**
 * The save route's own wording for these failures, translated. A fallback for
 * the toast in case anything reaches the server the editor didn't catch.
 */
export function explainQuestionSaveError(message: string): string {
  if (/options must be four distinct values/i.test(message)) {
    return "Two of the answers are the same. Change one so all four are different, then save.";
  }
  return message;
}
