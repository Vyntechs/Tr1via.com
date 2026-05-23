// reveal-sync.spec.ts — the "one press, three surfaces" Playwright test.
//
// This scaffold exists to lock in the contract for Phase 6. It will be
// runnable once Brandon stands up a Supabase project (local stack or
// hosted) and exports SUPABASE_LIVE=1. Until then it skip()s — the file
// still compiles so future schema/route changes that break the test type-
// surface get caught early.
//
// What it asserts when live:
//   1. Host (logged in) creates a night with one game + one category + one
//      question.
//   2. Three player contexts join via the room code.
//   3. Host reveals Q1; within 250ms all 3 phones display the 4 options and
//      the TV displays the prompt.
//   4. Each phone taps a different answer.
//   5. After 20s, all 3 phones + TV transition to reveal within 100ms of
//      each other.
//   6. Correct phones show the awarded points (+110 for fast-correct, +100
//      for slow-correct); wrong phones show "Not this one".
//
// See tests/e2e/README.md for setup notes.

import { test, type BrowserContext } from "@playwright/test";

const LIVE = process.env.SUPABASE_LIVE === "1";

test.describe("reveal sync — host → TV → 3 phones", () => {
  test.skip(!LIVE, "Requires a live Supabase. Export SUPABASE_LIVE=1 and configure the env.");

  test("host reveals, 3 phones answer, all see resolve at the same moment", async ({ browser }) => {
    // Five contexts: host laptop, TV (no auth), and 3 player phones.
    // Each is an isolated browsing context — separate cookie jars, so the
    // player phones each get their own device_id cookie.
    const contexts: BrowserContext[] = [];
    try {
      const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const phone1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const phone2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const phone3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      contexts.push(hostCtx, tvCtx, phone1, phone2, phone3);

      // Voids prefixed with `void` until each step is wired to real fixtures.
      // Step 1: host login (TODO: replace with the actual auth fixture once
      // Phase 5 lands its e2e helper).
      const host = await hostCtx.newPage();
      void host;
      // Step 2: host creates a night → returns { nightId, roomCode }.
      // Step 3: open TV at /tv/<code>.
      // Step 4: open 3 phones at /join, type the code, join.
      // Step 5: host reveals Q1; capture the timestamp on send.
      // Step 6: poll each phone for the question UI; record arrival times.
      // Step 7: each phone clicks a different answer (slot 1/2/3 on each).
      // Step 8: wait ~20s.
      // Step 9: assert all 4 surfaces are in reveal state within 100ms.
      // Step 10: assert the right per-phone result text.
      //
      // The pieces this needs are: a sign-in helper for the host (Phase 5),
      // a stable selector convention on the screens (Phase 2 components),
      // and a working Supabase project (any phase). Today it skips.
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});
