// Turns a finished response into a short, fixed-vocabulary label for the log.
//
// The log never stores a raw error message or response body: only the status
// and one of the reasons below. Anything unrecognised becomes "other".

export type AnswerOutcome =
  | "saved"
  | "duplicate"
  | "late"
  | "early"
  | "rejected"
  | "error";

export interface AnswerClass {
  outcome: AnswerOutcome;
  reason: string;
}

/** The only parts of a JSON response body the classifiers read. */
export interface ResponseBodyHint {
  [key: string]: unknown;
  error?: unknown;
  code?: unknown;
  duplicate?: unknown;
  alreadyResolved?: unknown;
  awardCount?: unknown;
  repeated?: unknown;
  result?: { code?: unknown } | null;
}

// Error text the answers route can send -> [outcome, reason].
const ANSWER_ERRORS: Record<string, [AnswerOutcome, string]> = {
  "invalid JSON": ["rejected", "invalid_json"],
  "no device session": ["rejected", "no_device_session"],
  "question not found": ["rejected", "question_not_found"],
  "category not found": ["rejected", "lookup_not_found"],
  "game not found": ["rejected", "lookup_not_found"],
  "night not found": ["rejected", "lookup_not_found"],
  "play not found": ["rejected", "play_not_found"],
  "question is not live": ["early", "question_not_live"],
  "answer deadline passed": ["late", "deadline_passed"],
  "question is closed": ["late", "question_closed"],
  "resilient answer payload required": ["rejected", "wrong_engine"],
  "answer engine mismatch": ["rejected", "wrong_engine"],
  "not joined to this night": ["rejected", "not_joined"],
  "you have been removed": ["rejected", "removed"],
  "not in this game": ["rejected", "not_in_game"],
  "scramble mismatch": ["rejected", "scramble_mismatch"],
  "already answered": ["duplicate", "already_answered"],
  "stale live play": ["rejected", "stale_play"],
  "invalid answer": ["rejected", "invalid_request"],
};

// Result codes the resilient (database-decided) engine returns with a 200.
const RESILIENT_CODES: Record<string, [AnswerOutcome, string]> = {
  confirmed: ["saved", "saved"],
  deadline_passed: ["late", "deadline_passed"],
  identity_invalid: ["rejected", "identity_invalid"],
  not_eligible: ["rejected", "not_eligible"],
  retry_later: ["error", "retry_later"],
  stale: ["rejected", "stale_play"],
  invalid_request: ["rejected", "invalid_request"],
};

/**
 * @param reachedInsert true when the handler got as far as saving the answer.
 *   The same "deadline passed" text comes from an early check and from the
 *   database's own rule at save time; the log keeps them apart.
 */
export function classifyAnswerResponse(
  status: number,
  body: ResponseBodyHint | null,
  reachedInsert = false,
): AnswerClass {
  if (status >= 500) return { outcome: "error", reason: "server_error" };

  const code = typeof body?.code === "string" ? body.code : null;
  if (code && RESILIENT_CODES[code]) {
    const [outcome, reason] = RESILIENT_CODES[code];
    if (outcome === "saved" && body?.duplicate === true) {
      return { outcome: "duplicate", reason: "already_answered" };
    }
    return { outcome, reason };
  }

  if (status >= 200 && status < 300) return { outcome: "saved", reason: "saved" };

  const text = typeof body?.error === "string" ? body.error : "";
  const known = ANSWER_ERRORS[text];
  if (known) {
    const [outcome, reason] = known;
    if (reason === "deadline_passed" && reachedInsert) {
      return { outcome, reason: "deadline_passed_at_save" };
    }
    if (reason === "question_closed" && reachedInsert) {
      return { outcome, reason: "question_closed_at_save" };
    }
    return { outcome, reason };
  }
  if (status === 400) return { outcome: "rejected", reason: "invalid_request" };
  return { outcome: "rejected", reason: `other_${status}` };
}

export interface ActionClass {
  outcome: string;
  reason: string;
}

const ACTION_ERRORS: Record<string, string> = {
  "invalid JSON": "invalid_json",
  "invalid play": "invalid_play",
  "not signed in": "not_signed_in",
  "host profile not found": "no_host_profile",
  "not your night": "not_your_night",
  "question not found": "question_not_found",
  "category not found": "lookup_not_found",
  "game not found": "lookup_not_found",
  "night not found": "lookup_not_found",
  "room not found": "lookup_not_found",
  "play not found": "play_not_found",
  "question is not in this game": "wrong_game",
  "question is not on the board": "not_on_board",
  "question already revealed": "already_revealed",
  "another question is already live in this game": "another_live",
  "question is not live": "question_not_live",
  "question is already resolved": "already_resolved",
  "question answer window is still open": "too_early",
  "answer is not resolved yet": "not_resolved_yet",
  "no reveal to undo": "nothing_to_undo",
  "game is already done": "game_done",
  "not all eligible players are locked": "not_all_locked",
  "night state changed; try again": "night_changed",
  "stale live play": "stale_play",
  "answer engine mismatch": "wrong_engine",
  "question is not the current play": "not_current_play",
  "could not update live game": "update_failed",
};

export function classifyActionResponse(
  status: number,
  body: ResponseBodyHint | null,
): ActionClass {
  if (status >= 500) return { outcome: "error", reason: "server_error" };

  if (status >= 200 && status < 300) {
    const code = body?.result && typeof body.result.code === "string" ? body.result.code : null;
    if (code) return { outcome: code.slice(0, 32), reason: "ok" };
    if (body?.alreadyResolved === true) return { outcome: "already_resolved", reason: "ok" };
    // The resolve call that actually closed the question (the first to arrive).
    if (typeof body?.awardCount === "number") return { outcome: "resolved", reason: "ok" };
    if (body?.repeated === true) return { outcome: "repeat", reason: "ok" };
    return { outcome: "ok", reason: "ok" };
  }

  const text = typeof body?.error === "string" ? body.error : "";
  let reason = ACTION_ERRORS[text];
  if (!reason && text.startsWith("undo window expired")) reason = "undo_window_expired";
  if (!reason) reason = "other";
  const outcome =
    status === 409 ? "conflict" : status === 401 || status === 403 ? "denied" : "rejected";
  return { outcome, reason };
}

/** Reads a cloned response body without ever throwing. */
export async function readBodyHint(res: Response | null): Promise<ResponseBodyHint | null> {
  if (!res) return null;
  try {
    const text = await res.text();
    if (!text || text.length > 20_000) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ResponseBodyHint) : null;
  } catch {
    return null;
  }
}

/** A short label for why a broadcast failed (never the raw message). */
export function broadcastErrorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError") return "timeout";
  const http = /^broadcast HTTP (\d)/.exec(message);
  if (http) return `http_${http[1]}xx`;
  if (message.startsWith("broadcastToRoom: missing")) return "no_config";
  return "network";
}
