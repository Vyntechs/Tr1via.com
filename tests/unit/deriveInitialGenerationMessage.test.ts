// Regression lock for the pick-page stranding bug.
//
// When the question-generation `after()` job rolls a category back to
// 'draft' (Anthropic error, validation throw, env hiccup, etc.) the
// broadcast can race the host's page subscription — the host can land on
// the pick page AFTER the broadcast has already fired and miss the error.
// Before this fix the page rendered the loading spinner indefinitely
// because: (a) the polling hook only engages when state='generating' and
// (b) the render branch only shows the error UI when a failure message is
// already set.
//
// This pure helper hydrates that failure message from the server-rendered
// initial props so a refresh into a rolled-back state surfaces the retry /
// manual-entry UI instead of staring at the spinner.
//
// Run: npm test -- deriveInitialGenerationMessage

import { describe, expect, it } from "vitest";
import {
  deriveInitialGenerationMessage,
  explainGenerationFailure,
} from "@/lib/host/generationFailureMessages";
import type { CategoryRow } from "@/lib/supabase/types";

type State = CategoryRow["state"];

describe("deriveInitialGenerationMessage", () => {
  it("returns a retry-friendly message when state='draft' with zero questions", () => {
    const msg = deriveInitialGenerationMessage({
      initialState: "draft" as State,
      initialQuestionCount: 0,
    });
    expect(msg).not.toBeNull();
    expect(msg).toBe(
      explainGenerationFailure({
        broadcastMessage: null,
        fromTimeout: false,
        fromRollback: true,
      }),
    );
  });

  it("returns null when state='draft' but the category already has questions", () => {
    // Defensive: a category with questions that's somehow in 'draft' should
    // render the pick UI (whatever the user can salvage), not strand the
    // host on an error screen.
    const msg = deriveInitialGenerationMessage({
      initialState: "draft" as State,
      initialQuestionCount: 5,
    });
    expect(msg).toBeNull();
  });

  it("returns null while the job is mid-flight (state='generating')", () => {
    const msg = deriveInitialGenerationMessage({
      initialState: "generating" as State,
      initialQuestionCount: 0,
    });
    expect(msg).toBeNull();
  });

  it("returns null when the category is ready for review", () => {
    const msg = deriveInitialGenerationMessage({
      initialState: "review" as State,
      initialQuestionCount: 20,
    });
    expect(msg).toBeNull();
  });

  it("returns null when the category is already locked", () => {
    const msg = deriveInitialGenerationMessage({
      initialState: "ready" as State,
      initialQuestionCount: 7,
    });
    expect(msg).toBeNull();
  });
});

describe("explainGenerationFailure (timeout copy)", () => {
  it("does not claim a fixed '60 seconds' — the timer is now idle-based", () => {
    // Regression guard: the old copy hard-coded "longer than 60 seconds", which
    // is misleading now that the safety timer measures silence (no heartbeat),
    // not a fixed window. The new copy must not reintroduce that number.
    const msg = explainGenerationFailure({
      broadcastMessage: null,
      fromTimeout: true,
      fromRollback: false,
    });
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toMatch(/60 seconds/);
  });
});
