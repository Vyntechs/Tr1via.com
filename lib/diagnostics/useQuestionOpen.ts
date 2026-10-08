// Tells the device reporter two things about this screen, so the reporter can
// stay quiet while it matters (see reporter.ts):
//   - whether a question is live (stay quiet until it closes), and
//   - whether the room has finished its first download (until then nobody
//     knows whether a question is live, so stay quiet too).
//
// Called from the hooks that already know the room state (useRoom for phones
// and the host screens, useTVRoom for the TV). It only sets flags in
// lib/diagnostics/client.ts; with logging off nothing listens to them.

"use client";

import { useEffect } from "react";
import { diagQuestionOpen, diagRoomReady } from "./client";

export function useDiagQuestionOpen(open: boolean, roomLoaded: boolean): void {
  // The question state first, then "loaded": the reporter must never see
  // "loaded" while a question that is already open is still reported as closed.
  useEffect(() => {
    diagQuestionOpen(open);
    if (roomLoaded) diagRoomReady();
  }, [open, roomLoaded]);
  // Leaving the page is the same as the question being over.
  useEffect(() => () => diagQuestionOpen(false), []);
}
