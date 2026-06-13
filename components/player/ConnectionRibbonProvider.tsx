// Mount-once host for the connection ribbon on the player surface.
// Reads the global browser online state AND the live Realtime channel
// health (published by useRoom when /room/[code] is mounted); renders
// the ribbon when either is unhealthy.

"use client";

import { ConnectionRibbon } from "./ConnectionRibbon";
import { useConnectionStatus } from "@/lib/hooks/useConnectionStatus";
import { useChannelHealth } from "@/lib/realtime/channelHealth";
import { useReachability } from "@/lib/realtime/reachability";
import { useRoomFallback } from "@/lib/room/roomFallbackStore";

export function ConnectionRibbonProvider() {
  const channelState = useChannelHealth();
  const reachability = useReachability();
  const { backupMode } = useRoomFallback();
  const status = useConnectionStatus({ channelState, reachability, backupMode });
  return <ConnectionRibbon status={status} />;
}
