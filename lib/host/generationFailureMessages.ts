// Host-facing messaging for the question-generation pipeline.
//
// Two pure helpers:
//
//   explainGenerationFailure({ broadcastMessage, fromTimeout, fromRollback })
//     Translates the various failure paths (server broadcast, client
//     polling timeout, DB rollback detected by polling) into one
//     human-readable line the host sees on the failure screen.
//
//   deriveInitialGenerationMessage({ initialState, initialQuestionCount })
//     Decides whether the host's pick page should mount straight into the
//     failure UI based on the server-rendered initial state. This closes
//     the race where a rolled-back generation broadcasts 'error' BEFORE
//     the host's browser has subscribed to the channel — without this,
//     the page renders the loading spinner forever on refresh because the
//     polling fallback only engages while state='generating'.
//
// Pure (no React, no fetches) so HostSetupPickClient + tests can call them.
//
// Tests: tests/unit/deriveInitialGenerationMessage.test.ts

import type { CategoryRow } from "@/lib/supabase/types";

export interface ExplainGenerationFailureInput {
  /** The error string forwarded from the server's `error` broadcast, if any. */
  broadcastMessage: string | null;
  /** True when the client-side polling hook hit its safety timeout. */
  fromTimeout: boolean;
  /** True when the polling hook detected the DB state was rolled back to 'draft'. */
  fromRollback: boolean;
}

/**
 * Map a failure signal to the line the host reads on the error screen.
 * Internal stack traces and HTTP detail are abstracted away — the host
 * cares whether to retry or to bail to manual entry.
 */
export function explainGenerationFailure(
  input: ExplainGenerationFailureInput,
): string {
  if (input.broadcastMessage && input.broadcastMessage.trim().length > 0) {
    return input.broadcastMessage;
  }
  if (input.fromRollback) {
    return "The generator gave up partway through. A retry usually works.";
  }
  if (input.fromTimeout) {
    return "The question builder went quiet and stopped sending progress. That usually means a brief hiccup on our end — give it another go, or type your seven by hand.";
  }
  return "Something went sideways while pulling your questions.";
}

export interface DeriveInitialGenerationMessageInput {
  initialState: CategoryRow["state"];
  initialQuestionCount: number;
}

/**
 * On page hydration, decide whether to seed the failure message so the
 * host lands directly on the retry / manual-entry UI instead of the
 * loading spinner.
 *
 * The only case we treat as "stranded": the DB says 'draft' AND zero
 * questions exist. That can only happen when the generation job ran,
 * threw, and rolled the row back — but the client wasn't subscribed in
 * time to catch the `error` broadcast.
 *
 * If state='draft' but questions exist (e.g. a regenerate that did some
 * work before failing, or a manual-entry session), let the pick UI
 * render whatever's there. The host can salvage instead of being
 * stranded on an error screen.
 */
export function deriveInitialGenerationMessage(
  input: DeriveInitialGenerationMessageInput,
): string | null {
  if (input.initialState === "draft" && input.initialQuestionCount === 0) {
    return explainGenerationFailure({
      broadcastMessage: null,
      fromTimeout: false,
      fromRollback: true,
    });
  }
  return null;
}
