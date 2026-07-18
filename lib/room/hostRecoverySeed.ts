import type {
  RoomFallbackPayload,
  RoomSnapshotPayload,
} from "@/lib/room/roomSnapshotPayload";

/**
 * Decide whether the host console should seed its direct-read state (live
 * answers / scores / board) from the last server-route payload.
 *
 * The host's direct subscriptions (e.g. the live-answers channel) hold values
 * frozen at the moment backup mode began — `postgres_changes` were missed while
 * the WiFi was degraded. When `useRoom` leaves backup mode, those direct reads
 * revert from the route payload (kept current by the ~5s poll) back to the stale
 * frozen values, so the host's "locked-in" count can flash stale (#3).
 * `setBackupMode(false)` nulls the payload in the SAME tick, so the caller must
 * pass the LAST non-null payload it captured while in backup mode.
 *
 * Returns the payload to seed from on a backup→direct (recovery) transition, or
 * `null` when no seeding is needed (not a recovery edge, or nothing captured).
 */
export function hostRecoverySeed(
  prevBackupMode: boolean,
  backupMode: boolean,
  lastPayload: RoomFallbackPayload | RoomSnapshotPayload | null,
): RoomFallbackPayload | null {
  const isRecovery = prevBackupMode && !backupMode;
  return isRecovery ? (lastPayload as unknown as RoomFallbackPayload) : null;
}
