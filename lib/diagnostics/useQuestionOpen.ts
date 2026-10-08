// Tells the device reporter whether a question is live on this screen, so the
// reporter can stay quiet until it closes (see reporter.ts).
//
// Called from the hooks that already know the room state (useRoom for phones
// and the host screens, useTVRoom for the TV). It only sets a flag in
// lib/diagnostics/client.ts; with logging off nothing listens to it.

"use client";

import { useEffect } from "react";
import { diagQuestionOpen } from "./client";

export function useDiagQuestionOpen(open: boolean): void {
  useEffect(() => {
    diagQuestionOpen(open);
  }, [open]);
  // Leaving the page is the same as the question being over.
  useEffect(() => () => diagQuestionOpen(false), []);
}
