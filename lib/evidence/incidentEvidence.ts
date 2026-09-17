import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type AnswerRejectionReason =
  | "deadline_passed"
  | "question_closed"
  | "late_retry_after_accept";

type RpcError = { code?: string; message?: string };
type EvidenceRpcClient = {
  rpc(
    name: "record_legacy_answer_rejection" | "record_incident_surface_event",
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: RpcError | null }>;
};

function evidenceRpc(): EvidenceRpcClient {
  // These additive private RPCs intentionally precede generated local types.
  // `npm run typegen` will make the cast unnecessary after the migration is
  // applied locally; do not hand-edit the generated file.
  return getSupabaseAdmin() as unknown as EvidenceRpcClient;
}

/** Evidence is never allowed to change an answer response or game state. */
export async function recordLegacyAnswerRejection(input: {
  questionId: string;
  playerId: string;
  actionId?: string;
  selectedIndex: number;
  receivedAt: Date;
  reason: AnswerRejectionReason;
  traceId?: string;
  releaseId?: string;
}): Promise<boolean> {
  try {
    const { error } = await evidenceRpc().rpc("record_legacy_answer_rejection", {
      p_question_id: input.questionId,
      p_player_id: input.playerId,
      p_client_action_id: input.actionId ?? null,
      p_selected_index: input.selectedIndex,
      p_received_at: input.receivedAt.toISOString(),
      p_reason: input.reason,
      p_trace_id: input.traceId ?? null,
      p_release_id: input.releaseId ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

function subjectKey(hostId: string, surfaceInstanceId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("missing evidence signing secret");
  return createHmac("sha256", secret)
    .update(`${hostId}:${surfaceInstanceId}`)
    .digest("hex");
}

/** Store a private browser-display receipt without exposing raw host identity. */
export async function recordHostSurfaceEvent(input: {
  nightId: string;
  hostId: string;
  answerEngine: "legacy" | "resilient_v1";
  gameId: string;
  questionId: string;
  stage: "question_open" | "timer_zero" | "answer_reveal";
  authoritativeAt: string;
  currentWhenReceived: boolean;
  surfaceInstanceId: string;
  releaseId?: string;
  traceId?: string;
}): Promise<boolean> {
  try {
    const { error } = await evidenceRpc().rpc("record_incident_surface_event", {
      p_night_id: input.nightId,
      p_player_id: null,
      p_answer_engine: input.answerEngine,
      p_game_id: input.gameId,
      p_question_id: input.questionId,
      p_run_id: null,
      p_play_id: null,
      p_stage: input.stage,
      p_event_kind: "frame_committed",
      p_surface_kind: "host_laptop",
      p_subject_key: subjectKey(input.hostId, input.surfaceInstanceId),
      p_authoritative_at: input.authoritativeAt,
      p_current_when_received: input.currentWhenReceived,
      p_room_revision: null,
      p_control_revision: null,
      p_server_room_revision_at_receipt: null,
      p_server_control_revision_at_receipt: null,
      p_delivery_path: "unknown",
      p_surface_session_id: input.surfaceInstanceId,
      p_client_event_id: randomUUID(),
      p_release_id: input.releaseId ?? null,
      p_trace_id: input.traceId ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}
