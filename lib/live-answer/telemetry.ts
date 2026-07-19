import type { LiveCanonicalResult } from "./rpcResult";

const LATENCY_BUCKETS = [
  "under_250ms",
  "250ms_to_1s",
  "1s_to_3s",
  "3s_to_10s",
  "10s_plus",
] as const;

const RESULT_CODES = [
  "applied",
  "resolved",
  "stale",
  "not_found",
  "invalid_state",
  "retry_later",
  "corrupt_state",
  "confirmed",
  "deadline_passed",
  "identity_invalid",
  "not_eligible",
  "invalid_request",
  "final_window",
  "not_due",
] as const satisfies readonly LiveCanonicalResult["code"][];

const RESOLUTION_REASONS = ["all_confirmed", "timer", "host"] as const;

export type LiveAnswerLatencyBucket = (typeof LATENCY_BUCKETS)[number];
export type LiveAnswerResultCode = (typeof RESULT_CODES)[number];
export type LiveAnswerResolutionReason =
  (typeof RESOLUTION_REASONS)[number];

export interface LiveAnswerHealthEvent {
  readonly playId: string;
  readonly latencyBucket?: LiveAnswerLatencyBucket;
  readonly resultCode: LiveAnswerResultCode;
  readonly retryCount?: number;
  readonly duplicateCount?: number;
  readonly reconciliationCount?: number;
  readonly resolutionReason?: LiveAnswerResolutionReason;
}

export type LiveAnswerHealthSink = (
  event: LiveAnswerHealthEvent,
) => void | Promise<void>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Converts exact duration into a coarse operational bucket. The exact value is
 * deliberately never part of the emitted event.
 */
export function latencyBucketFor(
  latencyMs: number,
): LiveAnswerLatencyBucket | null {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return null;
  if (latencyMs < 250) return "under_250ms";
  if (latencyMs < 1_000) return "250ms_to_1s";
  if (latencyMs < 3_000) return "1s_to_3s";
  if (latencyMs < 10_000) return "3s_to_10s";
  return "10s_plus";
}

/**
 * Builds a new event from an exact allowlist. Unknown fields are never read,
 * so request bodies, identity, answers, credentials, and raw errors cannot be
 * copied into the telemetry sink by this boundary.
 */
export function createLiveAnswerHealthEvent(
  input: unknown,
): Readonly<LiveAnswerHealthEvent> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  try {
    const source = input as Record<string, unknown>;
    const playId = source.playId;
    const latencyBucket = source.latencyBucket;
    const resultCode = source.resultCode;
    const retryCount = source.retryCount;
    const duplicateCount = source.duplicateCount;
    const reconciliationCount = source.reconciliationCount;
    const resolutionReason = source.resolutionReason;

    if (typeof playId !== "string" || !UUID_PATTERN.test(playId)) {
      return null;
    }
    if (!isOptionalMember(latencyBucket, LATENCY_BUCKETS)) return null;
    if (!isMember(resultCode, RESULT_CODES)) return null;
    if (!isOptionalCount(retryCount)) return null;
    if (!isOptionalCount(duplicateCount)) return null;
    if (!isOptionalCount(reconciliationCount)) return null;
    if (!isOptionalMember(resolutionReason, RESOLUTION_REASONS)) {
      return null;
    }

    const event = {
      playId,
      ...(latencyBucket === undefined ? {} : { latencyBucket }),
      resultCode,
      ...(retryCount === undefined ? {} : { retryCount }),
      ...(duplicateCount === undefined ? {} : { duplicateCount }),
      ...(reconciliationCount === undefined ? {} : { reconciliationCount }),
      ...(resolutionReason === undefined ? {} : { resolutionReason }),
    } satisfies LiveAnswerHealthEvent;

    return Object.freeze(event);
  } catch {
    return null;
  }
}

/**
 * Telemetry is best-effort and can never change the result of a committed live
 * mutation. `false` means the event was invalid or the collector was down.
 */
export async function recordLiveAnswerHealth(
  input: unknown,
  sink: LiveAnswerHealthSink,
): Promise<boolean> {
  const event = createLiveAnswerHealthEvent(input);
  if (!event) return false;

  try {
    await sink(event);
    return true;
  } catch {
    return false;
  }
}

function isOptionalMember<const T extends readonly string[]>(
  value: unknown,
  allowlist: T,
): value is T[number] | undefined {
  return value === undefined || allowlist.some((candidate) => candidate === value);
}

function isMember<const T extends readonly string[]>(
  value: unknown,
  allowlist: T,
): value is T[number] {
  return allowlist.some((candidate) => candidate === value);
}

function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}
