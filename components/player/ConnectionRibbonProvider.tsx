// Mount-once host for the connection ribbon on the player surface.
// Reads the global browser online state and conditionally renders the
// ribbon when the connection isn't healthy.

"use client";

import { ConnectionRibbon } from "./ConnectionRibbon";
import { useConnectionStatus } from "@/lib/hooks/useConnectionStatus";

export function ConnectionRibbonProvider() {
  const status = useConnectionStatus();
  return <ConnectionRibbon status={status} />;
}
