import { z } from "zod";

import type { LiveRoomEventKind } from "./contracts";

export interface LiveRpcEnvelope<T> {
  freshlyApplied: boolean;
  result: T;
}

export interface ParsedLiveRpcEnvelope<T> extends LiveRpcEnvelope<T> {
  freshness: "transaction_winner" | "replay" | "non_winner";
}

const Uuid = z.string().uuid();
const Revision = z.number().int().nonnegative();
const RetryLaterResultSchema = z
  .object({
    code: z.literal("retry_later"),
    retryAfterMs: z.number().int().positive(),
  })
  .strict();
const CorruptResultSchema = z
  .object({ code: z.literal("corrupt_state"), applied: z.literal(false) })
  .strict();

const AppliedCommandBase = {
  code: z.literal("applied"),
  applied: z.literal(true),
  runId: Uuid,
  roomRevision: Revision,
  controlRevision: Revision,
};

const CommandAppliedResultSchema = z.union([
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("night_opened"),
    })
    .strict(),
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("game_started"),
      gameId: Uuid,
    })
    .strict(),
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("play_opened"),
      gameId: Uuid,
      playId: Uuid,
    })
    .strict(),
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("final_window_started"),
      playId: Uuid,
    })
    .strict(),
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("play_undone"),
      playId: Uuid,
    })
    .strict(),
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("game_ended"),
      gameId: Uuid,
    })
    .strict(),
  z
    .object({
      ...AppliedCommandBase,
      eventKind: z.literal("night_reset"),
      previousRunId: Uuid,
    })
    .strict(),
]);

const ResolvedResultSchema = z
  .object({
    code: z.literal("resolved"),
    applied: z.literal(true),
    eventKind: z.literal("play_resolved"),
    runId: Uuid,
    playId: Uuid,
    roomRevision: Revision,
    controlRevision: Revision,
  })
  .strict();

const CommandRejectedResultSchema = z
  .object({
    code: z.enum(["stale", "not_found", "invalid_state"]),
    applied: z.literal(false),
  })
  .strict();

const LiveCommandResultSchema = z.union([
  CommandAppliedResultSchema,
  ResolvedResultSchema,
  CommandRejectedResultSchema,
  RetryLaterResultSchema,
  CorruptResultSchema,
]);

const ConfirmedAnswerResultSchema = z
  .object({
    code: z.literal("confirmed"),
    confirmedSlot: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    duplicate: z.literal(false),
    eventKind: z.literal("answer_progress"),
    runId: Uuid,
    playId: Uuid,
    roomRevision: Revision,
    controlRevision: Revision,
  })
  .strict();

const AnswerRejectedResultSchema = z
  .object({
    code: z.enum([
      "deadline_passed",
      "identity_invalid",
      "not_eligible",
      "invalid_request",
      "stale",
    ]),
  })
  .strict();

const LiveAnswerResultSchema = z.union([
  ConfirmedAnswerResultSchema,
  AnswerRejectedResultSchema,
  RetryLaterResultSchema,
  CorruptResultSchema,
]);

const FinalWindowResultSchema = z
  .object({
    code: z.literal("final_window"),
    applied: z.literal(true),
    eventKind: z.literal("final_window_started"),
    runId: Uuid,
    playId: Uuid,
    roomRevision: Revision,
    controlRevision: Revision,
  })
  .strict();

const NotDueResultSchema = z
  .object({
    code: z.literal("not_due"),
    applied: z.literal(false),
    runId: Uuid,
    playId: Uuid,
    roomRevision: Revision,
    controlRevision: Revision,
  })
  .strict();

const FinalizeRejectedResultSchema = z
  .object({
    code: z.enum(["stale", "not_found"]),
    applied: z.literal(false),
  })
  .strict();

const LiveFinalizeResultSchema = z.union([
  ResolvedResultSchema,
  FinalWindowResultSchema,
  NotDueResultSchema,
  FinalizeRejectedResultSchema,
  RetryLaterResultSchema,
  CorruptResultSchema,
]);

export type LiveCommandResult = z.infer<typeof LiveCommandResultSchema>;
export type LiveAnswerResult = z.infer<typeof LiveAnswerResultSchema>;
export type LiveFinalizeResult = z.infer<typeof LiveFinalizeResultSchema>;
export type LiveCanonicalResult =
  | LiveCommandResult
  | LiveAnswerResult
  | LiveFinalizeResult;

export interface FreshLiveEventReference {
  applied: true;
  freshness: "transaction_winner";
  kind: LiveRoomEventKind;
  runId: string;
  roomRevision: number;
  controlRevision: number;
  playId: string | null;
}

export function parseLiveCommandRpcEnvelope(
  value: unknown,
): ParsedLiveRpcEnvelope<LiveCommandResult> | null {
  return parseEnvelope(value, LiveCommandResultSchema);
}

export function parseLiveAnswerRpcEnvelope(
  value: unknown,
): ParsedLiveRpcEnvelope<LiveAnswerResult> | null {
  return parseEnvelope(value, LiveAnswerResultSchema);
}

export function parseLiveFinalizeRpcEnvelope(
  value: unknown,
): ParsedLiveRpcEnvelope<LiveFinalizeResult> | null {
  return parseEnvelope(value, LiveFinalizeResultSchema);
}

/**
 * Returns a broadcast candidate only when the database explicitly says this
 * request won the transaction. Applied results, revisions, and event kinds do
 * not independently establish freshness.
 */
export function freshLiveEventFromRpc(
  envelope: ParsedLiveRpcEnvelope<LiveCanonicalResult> | null,
): FreshLiveEventReference | null {
  if (
    !envelope ||
    envelope.freshlyApplied !== true ||
    envelope.freshness !== "transaction_winner"
  ) {
    return null;
  }
  const result = envelope.result;
  if (!("eventKind" in result) || !("runId" in result)) return null;

  return {
    applied: true,
    freshness: "transaction_winner",
    kind: result.eventKind,
    runId: result.runId,
    roomRevision: result.roomRevision,
    controlRevision: result.controlRevision,
    playId: "playId" in result ? (result.playId ?? null) : null,
  };
}

function parseEnvelope<T>(
  value: unknown,
  resultSchema: z.ZodType<T>,
): ParsedLiveRpcEnvelope<T> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.prototype.hasOwnProperty.call(value, "freshlyApplied") ||
    !Object.prototype.hasOwnProperty.call(value, "result")
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "freshlyApplied" && key !== "result")) {
    return null;
  }
  if (typeof record.freshlyApplied !== "boolean") return null;
  const parsedResult = resultSchema.safeParse(record.result);
  if (!parsedResult.success) return null;
  if (record.freshlyApplied && !isAppliedEventResult(parsedResult.data)) {
    return null;
  }

  return {
    freshlyApplied: record.freshlyApplied,
    freshness: record.freshlyApplied
      ? "transaction_winner"
      : isAppliedEventResult(parsedResult.data)
        ? "replay"
        : "non_winner",
    result: parsedResult.data,
  };
}

function isAppliedEventResult(value: unknown): value is {
  eventKind: LiveRoomEventKind;
  runId: string;
  roomRevision: number;
  controlRevision: number;
  playId?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventKind" in value &&
    "runId" in value &&
    "roomRevision" in value &&
    "controlRevision" in value
  );
}
