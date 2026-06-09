// Regression tests for the host pick-flow failure mappers + resync trigger.
// Each describe block pins one of the bugs found auditing the edit→save→build
// →reroll surface after the atomic point-value swap (#99) shipped.

import { describe, it, expect } from "vitest";
import {
  QUESTION_REPLACED_MESSAGE,
  explainLockFailure,
  explainPhotoSaveFailure,
  explainUploadFailure,
  pointValueChanged,
} from "@/lib/host/pickFlowMessages";

// B2 — Lock used to surface the raw server string
// "expected 7 questions in this category, found 6" to the host.
describe("explainLockFailure (B2: raw lock error)", () => {
  it("translates the stale-pick count string to a re-pick instruction", () => {
    const out = explainLockFailure(
      400,
      "expected 7 questions in this category, found 6",
    );
    expect(out).toMatch(/re-pick/i);
    // The raw count / wording must never leak.
    expect(out).not.toMatch(/expected 7 questions/i);
  });

  it("treats a 404 (picked id deleted by reroll) as a stale set", () => {
    expect(explainLockFailure(404, "not found")).toMatch(/re-pick/i);
  });

  it("maps auth failures to a refresh hint", () => {
    expect(explainLockFailure(401, null)).toMatch(/sign-in expired/i);
  });

  it("falls back to a friendly generic for an unknown failure", () => {
    const out = explainLockFailure(500, "duplicate key value violates ...");
    expect(out).toMatch(/couldn't lock/i);
    expect(out).not.toMatch(/duplicate key/i);
  });
});

// B3 — Photo swap on a rerolled-away question used to show the route's raw
// "failed to update photo: <pg message>" / "question not found".
describe("explainPhotoSaveFailure (B3: raw photo-swap error)", () => {
  it("maps a 404 to the shared replaced-question message", () => {
    expect(explainPhotoSaveFailure(404)).toBe(QUESTION_REPLACED_MESSAGE);
  });

  it("maps any other failure to a friendly retry (status-only, no raw string can leak)", () => {
    const out = explainPhotoSaveFailure(400);
    expect(out).toMatch(/try another image|skip it/i);
    expect(out).not.toMatch(/duplicate key|failed to update photo/i);
  });
});

// B4 — Upload on a rerolled-away question fell through to rendering the raw
// "question not found" because explainUploadFailure had no 404 branch.
describe("explainUploadFailure (B4: stale-id upload)", () => {
  it("maps a 404 to the shared replaced-question message", () => {
    expect(explainUploadFailure("question not found", 404)).toBe(
      QUESTION_REPLACED_MESSAGE,
    );
  });

  it("still maps the storage cases it always handled", () => {
    expect(explainUploadFailure("File too large", 400)).toMatch(/10 MB/);
    expect(explainUploadFailure("not a supported image", 400)).toMatch(
      /PNG, JPEG/,
    );
    expect(explainUploadFailure(undefined, 500)).toMatch(/try again/i);
  });
});

// B1 — After a point-value change the server's swap_point_value RPC can
// displace a second row the client never saw; the board must be refetched.
describe("pointValueChanged (B1: displaced-row resync trigger)", () => {
  it("is true when a slot is reassigned", () => {
    expect(pointValueChanged(300, 500)).toBe(true);
  });

  it("is true when assigning into / clearing a previously-empty slot", () => {
    expect(pointValueChanged(null, 200)).toBe(true);
    expect(pointValueChanged(400, null)).toBe(true);
  });

  it("treats null and undefined as the same unplaced state", () => {
    expect(pointValueChanged(undefined, null)).toBe(false);
  });

  it("is false when the slot is unchanged (no displacement possible)", () => {
    expect(pointValueChanged(300, 300)).toBe(false);
  });
});
