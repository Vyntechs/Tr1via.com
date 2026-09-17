/**
 * Privacy-safe operational evidence for live-game investigations.
 *
 * This boundary deliberately accepts `unknown` and copies only a fixed set of
 * non-player fields into the emitted event. Request bodies, cookies, names,
 * answer choices, device identity, raw errors, and other caller-owned values
 * are never inspected. Invalid values fail closed instead of being coerced.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVENTS = [
  "game_question_open",
  "game_answer_result",
  "game_question_finalize",
  "game_broadcast_result",
  "game_release_mismatch",
  "game_error",
] as const;

const ENGINES = ["legacy", "resilient_v1"] as const;
const SURFACES = [
  "player",
  "host_laptop",
  "host_phone",
  "tv",
  "server",
] as const;
const RELEASE_STATES = ["same", "mixed", "unknown"] as const;

const QUESTION_OPEN_OUTCOMES = ["applied", "replayed", "rejected"] as const;
const ANSWER_OUTCOMES = [
  "accepted",
  "deadline_passed",
  "question_closed",
  "duplicate",
  "not_eligible",
  "identity_invalid",
  "invalid_request",
  "retry_later",
  "failed",
] as const;
const FINALIZE_OUTCOMES = [
  "resolved",
  "already_resolved",
  "not_due",
  "rejected",
  "failed",
] as const;
const BROADCAST_OUTCOMES = [
  "supabase_accepted",
  "timeout",
  "http_error",
  "configuration_error",
  "failed",
] as const;
const FINALIZE_TRIGGERS = ["timer", "all_confirmed", "host"] as const;
const BROADCAST_ACTIONS = [
  "question_opened",
  "answer_progress",
  "question_resolved",
  "question_ended_early",
  "game_started",
  "game_ended",
  "play_undone",
  "recovery_wakeup",
] as const;
const ERROR_ACTIONS = [
  "question_open",
  "answer_submit",
  "question_finalize",
  "question_end_early",
  "room_broadcast",
  "surface_observe",
  "snapshot_recovery",
  "live_state_project",
] as const;
const ERROR_CODES = [
  "db_read_failed",
  "db_write_failed",
  "db_rpc_failed",
  "invalid_database_result",
  "broadcast_failed",
  "projection_failed",
  "unavailable_state",
  "unexpected",
] as const;

const TIMING_BUCKETS = [
  "under_250ms",
  "250ms_to_1s",
  "1s_to_3s",
  "3s_to_10s",
  "10s_plus",
] as const;
const DEADLINE_DELTA_BUCKETS = [
  "before_deadline",
  "at_deadline",
  "under_250ms_late",
  "250ms_to_1s_late",
  "1s_to_3s_late",
  "3s_to_10s_late",
  "10s_plus_late",
] as const;

export const GAME_EVIDENCE_SCHEMA = "tr1via.game_evidence.v1" as const;

export type GameEvidenceEventName = (typeof EVENTS)[number];
export type GameEvidenceLevel = "info" | "warn" | "error";
export type GameEngine = (typeof ENGINES)[number];
export type GameSurface = (typeof SURFACES)[number];
export type ReleaseState = (typeof RELEASE_STATES)[number];
export type TimingBucket = (typeof TIMING_BUCKETS)[number];
export type DeadlineDeltaBucket = (typeof DEADLINE_DELTA_BUCKETS)[number];

export interface GameEvidenceEvent {
  readonly schema: typeof GAME_EVIDENCE_SCHEMA;
  readonly level: GameEvidenceLevel;
  readonly event: GameEvidenceEventName;
  readonly engine?: GameEngine;
  readonly surface?: GameSurface;
  readonly nightId?: string;
  readonly gameId?: string;
  readonly questionId?: string;
  readonly playId?: string;
  readonly outcome?: string;
  readonly action?: string;
  readonly trigger?: string;
  readonly errorCode?: string;
  readonly openedAt?: string;
  readonly deadlineAt?: string;
  readonly resolvedAt?: string;
  readonly durationSeconds?: number;
  readonly latencyBucket?: TimingBucket;
  readonly deadlineDeltaBucket?: DeadlineDeltaBucket;
  readonly eligibleCount?: number;
  readonly confirmedCount?: number;
  readonly retryCount?: number;
  readonly roomRevision?: number;
  readonly controlRevision?: number;
  readonly clientRelease?: string;
  readonly clientDeploymentId?: string;
  readonly serverRelease?: string;
  readonly serverDeploymentId?: string;
  readonly releaseState?: ReleaseState;
}

export type GameEvidenceSink = (
  serializedEvent: string,
  level: GameEvidenceLevel,
) => void | Promise<void>;

/** Vercel-friendly latency bucket; exact player timings stay out of logs. */
export function timingBucketFor(latencyMs: number): TimingBucket | null {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return null;
  if (latencyMs < 250) return "under_250ms";
  if (latencyMs < 1_000) return "250ms_to_1s";
  if (latencyMs < 3_000) return "1s_to_3s";
  if (latencyMs < 10_000) return "3s_to_10s";
  return "10s_plus";
}

/**
 * Buckets a server-authored instant against the official deadline. Zero is a
 * distinct bucket because the answer boundary is exclusive: 25.000s is out.
 */
export function deadlineDeltaBucketFor(
  deltaMs: number,
): DeadlineDeltaBucket | null {
  if (!Number.isFinite(deltaMs)) return null;
  if (deltaMs < 0) return "before_deadline";
  if (deltaMs === 0) return "at_deadline";
  if (deltaMs < 250) return "under_250ms_late";
  if (deltaMs < 1_000) return "250ms_to_1s_late";
  if (deltaMs < 3_000) return "1s_to_3s_late";
  if (deltaMs < 10_000) return "3s_to_10s_late";
  return "10s_plus_late";
}

/**
 * Copies only the explicit operational allowlist. Unknown properties are not
 * enumerated or read, which makes this a data-loss-prevention boundary rather
 * than a general-purpose logger.
 */
export function createGameEvidenceEvent(
  input: unknown,
): Readonly<GameEvidenceEvent> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  try {
    const source = input as Record<string, unknown>;
    const event = source.event;
    if (!isMember(event, EVENTS)) return null;

    const engine = source.engine;
    const surface = source.surface;
    const nightId = source.nightId;
    const gameId = source.gameId;
    const questionId = source.questionId;
    const playId = source.playId;
    const openedAt = source.openedAt;
    const deadlineAt = source.deadlineAt;
    const resolvedAt = source.resolvedAt;
    const durationSeconds = source.durationSeconds;
    const latencyBucket = source.latencyBucket;
    const deadlineDeltaBucket = source.deadlineDeltaBucket;
    const eligibleCount = source.eligibleCount;
    const confirmedCount = source.confirmedCount;
    const retryCount = source.retryCount;
    const roomRevision = source.roomRevision;
    const controlRevision = source.controlRevision;
    const clientRelease = source.clientRelease;
    const clientDeploymentId = source.clientDeploymentId;
    const serverRelease = source.serverRelease;
    const serverDeploymentId = source.serverDeploymentId;
    const releaseState = source.releaseState;

    if (!isOptionalMember(engine, ENGINES)) return null;
    if (!isOptionalMember(surface, SURFACES)) return null;
    if (!isOptionalUuid(nightId) || !isOptionalUuid(gameId)) return null;
    if (!isOptionalUuid(questionId) || !isOptionalUuid(playId)) return null;
    if (!isOptionalIsoInstant(openedAt)) return null;
    if (!isOptionalIsoInstant(deadlineAt)) return null;
    if (!isOptionalIsoInstant(resolvedAt)) return null;
    if (!isOptionalPositiveDuration(durationSeconds)) return null;
    if (!isOptionalMember(latencyBucket, TIMING_BUCKETS)) return null;
    if (!isOptionalMember(deadlineDeltaBucket, DEADLINE_DELTA_BUCKETS)) return null;
    if (!isOptionalCount(eligibleCount) || !isOptionalCount(confirmedCount)) return null;
    if (!isOptionalCount(retryCount)) return null;
    if (!isOptionalCount(roomRevision) || !isOptionalCount(controlRevision)) return null;
    if (!isOptionalRelease(clientRelease) || !isOptionalRelease(serverRelease)) return null;
    if (!isOptionalDeploymentId(clientDeploymentId) || !isOptionalDeploymentId(serverDeploymentId)) return null;
    if (!isOptionalMember(releaseState, RELEASE_STATES)) return null;

    const specifics = validateEventSpecificFields(event, source, {
      engine,
      surface,
      questionId,
      playId,
      openedAt,
      deadlineAt,
      resolvedAt,
      durationSeconds,
      latencyBucket,
      deadlineDeltaBucket,
      releaseState,
      clientRelease,
      clientDeploymentId,
      serverRelease,
      serverDeploymentId,
    });
    if (!specifics) return null;

    const output: GameEvidenceEvent = {
      schema: GAME_EVIDENCE_SCHEMA,
      level: specifics.level,
      event,
      ...copyOptional("engine", engine),
      ...copyOptional("surface", surface),
      ...copyOptional("nightId", nightId),
      ...copyOptional("gameId", gameId),
      ...copyOptional("questionId", questionId),
      ...copyOptional("playId", playId),
      ...copyOptional("outcome", specifics.outcome),
      ...copyOptional("action", specifics.action),
      ...copyOptional("trigger", specifics.trigger),
      ...copyOptional("errorCode", specifics.errorCode),
      ...copyOptional("openedAt", openedAt),
      ...copyOptional("deadlineAt", deadlineAt),
      ...copyOptional("resolvedAt", resolvedAt),
      ...copyOptional("durationSeconds", durationSeconds),
      ...copyOptional("latencyBucket", latencyBucket),
      ...copyOptional("deadlineDeltaBucket", deadlineDeltaBucket),
      ...copyOptional("eligibleCount", eligibleCount),
      ...copyOptional("confirmedCount", confirmedCount),
      ...copyOptional("retryCount", retryCount),
      ...copyOptional("roomRevision", roomRevision),
      ...copyOptional("controlRevision", controlRevision),
      ...copyOptional("clientRelease", clientRelease),
      ...copyOptional("clientDeploymentId", clientDeploymentId),
      ...copyOptional("serverRelease", serverRelease),
      ...copyOptional("serverDeploymentId", serverDeploymentId),
      ...copyOptional("releaseState", releaseState),
    };
    return Object.freeze(output);
  } catch {
    return null;
  }
}

/**
 * Best-effort by contract. Invalid evidence and collector failures are
 * reported as `false`; neither may change the result of a live-game action.
 */
export async function recordGameEvidence(
  input: unknown,
  sink: GameEvidenceSink = gameEvidenceConsoleSink,
): Promise<boolean> {
  const event = createGameEvidenceEvent(input);
  if (!event) return false;
  try {
    await sink(JSON.stringify(event), event.level);
    return true;
  } catch {
    return false;
  }
}

export const gameEvidenceConsoleSink: GameEvidenceSink = (serialized, level) => {
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
};

interface CommonValidatedFields {
  engine: unknown;
  surface: unknown;
  questionId: unknown;
  playId: unknown;
  openedAt: unknown;
  deadlineAt: unknown;
  resolvedAt: unknown;
  durationSeconds: unknown;
  latencyBucket: unknown;
  deadlineDeltaBucket: unknown;
  releaseState: unknown;
  clientRelease: unknown;
  clientDeploymentId: unknown;
  serverRelease: unknown;
  serverDeploymentId: unknown;
}

interface EventSpecificFields {
  level: GameEvidenceLevel;
  outcome?: string;
  action?: string;
  trigger?: string;
  errorCode?: string;
}

function validateEventSpecificFields(
  event: GameEvidenceEventName,
  source: Record<string, unknown>,
  fields: CommonValidatedFields,
): EventSpecificFields | null {
  if (event === "game_question_open") {
    const outcome = source.outcome;
    if (!isMember(fields.engine, ENGINES) || !isUuid(fields.questionId)) return null;
    if (!isMember(outcome, QUESTION_OPEN_OUTCOMES)) return null;
    if (
      outcome !== "rejected" &&
      (!isIsoInstant(fields.openedAt) ||
        !isIsoInstant(fields.deadlineAt) ||
        !isPositiveDuration(fields.durationSeconds))
    ) return null;
    return { level: outcome === "rejected" ? "warn" : "info", outcome };
  }

  if (event === "game_answer_result") {
    const outcome = source.outcome;
    if (!isMember(fields.engine, ENGINES)) return null;
    if (!isUuid(fields.questionId) && !isUuid(fields.playId)) return null;
    if (!isMember(outcome, ANSWER_OUTCOMES)) return null;
    if (
      outcome === "deadline_passed" &&
      !isMember(fields.deadlineDeltaBucket, DEADLINE_DELTA_BUCKETS)
    ) return null;
    return {
      level: outcome === "accepted" || outcome === "duplicate" ? "info" : "warn",
      outcome,
    };
  }

  if (event === "game_question_finalize") {
    const outcome = source.outcome;
    const trigger = source.trigger;
    if (!isMember(fields.engine, ENGINES)) return null;
    if (!isUuid(fields.questionId) && !isUuid(fields.playId)) return null;
    if (!isMember(outcome, FINALIZE_OUTCOMES)) return null;
    if (!isMember(trigger, FINALIZE_TRIGGERS)) return null;
    if (
      outcome === "resolved" &&
      (!isIsoInstant(fields.deadlineAt) ||
        !isIsoInstant(fields.resolvedAt) ||
        !isMember(fields.deadlineDeltaBucket, DEADLINE_DELTA_BUCKETS))
    ) return null;
    return { level: outcome === "failed" ? "error" : "info", outcome, trigger };
  }

  if (event === "game_broadcast_result") {
    const action = source.action;
    const outcome = source.outcome;
    if (!isMember(action, BROADCAST_ACTIONS)) return null;
    if (!isMember(outcome, BROADCAST_OUTCOMES)) return null;
    if (!isMember(fields.latencyBucket, TIMING_BUCKETS)) return null;
    return {
      level: outcome === "supabase_accepted" ? "info" : "warn",
      action,
      outcome,
    };
  }

  if (event === "game_release_mismatch") {
    if (!isMember(fields.surface, SURFACES) || fields.surface === "server") return null;
    if (fields.releaseState !== "mixed") return null;
    const hasComparablePair =
      (isRelease(fields.clientRelease) && isRelease(fields.serverRelease)) ||
      (isDeploymentId(fields.clientDeploymentId) &&
        isDeploymentId(fields.serverDeploymentId));
    if (!hasComparablePair) return null;
    return { level: "warn" };
  }

  const action = source.action;
  const errorCode = source.errorCode;
  if (!isMember(action, ERROR_ACTIONS) || !isMember(errorCode, ERROR_CODES)) {
    return null;
  }
  return { level: "error", action, errorCode };
}

function copyOptional<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined ? {} : { [key]: value } as Record<K, V>;
}

function isMember<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return values.some((candidate) => candidate === value);
}

function isOptionalMember<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] | undefined {
  return value === undefined || isMember(value, values);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isOptionalUuid(value: unknown): value is string | undefined {
  return value === undefined || isUuid(value);
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isOptionalIsoInstant(value: unknown): value is string | undefined {
  return value === undefined || isIsoInstant(value);
}

function isPositiveDuration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 600;
}

function isOptionalPositiveDuration(value: unknown): value is number | undefined {
  return value === undefined || isPositiveDuration(value);
}

function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined ||
    (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000);
}

function isRelease(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}

function isOptionalRelease(value: unknown): value is string | undefined {
  return value === undefined || isRelease(value);
}

function isDeploymentId(value: unknown): value is string {
  return typeof value === "string" && /^dpl_[A-Za-z0-9]{6,64}$/.test(value);
}

function isOptionalDeploymentId(value: unknown): value is string | undefined {
  return value === undefined || isDeploymentId(value);
}
