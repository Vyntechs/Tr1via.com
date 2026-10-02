// The moments of a night, as the venue TV shows them.
//
// The TV's screen switcher (TVStateMachine) already decides which screen is
// up. Each screen announces its moment here so a world layer mounted ABOVE
// the switcher can react without re-deriving game state. Read-only: nothing
// here can change what the game does.

export type TVMomentKind =
  | "lobby"
  | "board"
  | "question"
  | "reveal"
  | "standings"
  | "between-games"
  | "winner";

export interface TVMoment {
  kind: TVMomentKind;
  /** Question on screen (question + reveal moments). */
  questionId: string | null;
  /** Server time the question went live, ms. Question moment only. */
  revealedAtMs: number | null;
  /** Server "now" when that reveal was broadcast, ms (clock-skew anchor). */
  serverNowMs: number | null;
}

export const NO_MOMENT: TVMoment = {
  kind: "lobby",
  questionId: null,
  revealedAtMs: null,
  serverNowMs: null,
};

export function sameMoment(a: TVMoment, b: TVMoment): boolean {
  return (
    a.kind === b.kind &&
    a.questionId === b.questionId &&
    a.revealedAtMs === b.revealedAtMs &&
    a.serverNowMs === b.serverNowMs
  );
}
