/**
 * Pure, audience-safe stage model for the live host console.
 *
 * The adapter that builds this input from RoomSnapshot/TVSnapshot must retain
 * resolved-question ownership so historical reveal state cannot become the
 * next game's result.
 */
export type HostStage =
  | "game-ready"
  | "board"
  | "private-preview"
  | "question-live"
  | "answer-result"
  | "intermission"
  | "finale";

export type HostPrimaryAction =
  | "start-game-1"
  | "show-question"
  | "end-early"
  | "return-to-board"
  | "start-game-2"
  | "present-winners"
  | "end-game"
  | null;

type HostGameState = "draft" | "ready" | "live" | "done" | null;
type HostGameNumber = 1 | 2;

export interface HostResolveRef {
  id: string;
  game: HostGameNumber;
}

export interface HostStageInput {
  game1: HostGameState;
  game2: HostGameState;
  /** The authoritative current game, when the source snapshot identifies it. */
  currentGame?: HostGameNumber | null;
  livePlay: string | null;
  /** A resolved question and the game that owns it. */
  lastResolve: HostResolveRef | null;
  nightClosed: boolean;
  stagedQuestion?: string | null;
  winnersPresented?: boolean;
}

export interface HostStageContext {
  stage: HostStage;
  primary: HostPrimaryAction;
}

function activeGame(input: HostStageInput): HostGameNumber | null {
  if (input.currentGame) return input.currentGame;
  if (input.game1 === "live") return 1;
  if (input.game2 === "live") return 2;
  return null;
}

function resolvedInCurrentGame(
  lastResolve: unknown,
  currentGame: HostGameNumber | null,
): boolean {
  if (!lastResolve || typeof lastResolve !== "object" || !currentGame) return false;
  const resolve = lastResolve as Partial<HostResolveRef>;
  return typeof resolve.id === "string" && resolve.game === currentGame;
}

export function deriveHostStage(input: HostStageInput): HostStageContext {
  const isFinale =
    input.nightClosed ||
    input.game2 === "done" ||
    (input.game1 === "done" && input.game2 === null);
  if (isFinale) {
    return {
      stage: "finale",
      primary: input.winnersPresented ? "end-game" : "present-winners",
    };
  }

  const isIntermission =
    input.game1 === "done" &&
    input.game2 !== null &&
    input.game2 !== "live";
  if (isIntermission) {
    return { stage: "intermission", primary: "start-game-2" };
  }

  const currentGame = activeGame(input);
  const currentGameState = currentGame === 1 ? input.game1 : input.game2;
  if (currentGameState !== "live") {
    return { stage: "game-ready", primary: "start-game-1" };
  }

  if (input.livePlay) {
    return { stage: "question-live", primary: "end-early" };
  }

  if (input.stagedQuestion) {
    return { stage: "private-preview", primary: "show-question" };
  }

  if (resolvedInCurrentGame(input.lastResolve, currentGame)) {
    return { stage: "answer-result", primary: "return-to-board" };
  }

  return { stage: "board", primary: null };
}
