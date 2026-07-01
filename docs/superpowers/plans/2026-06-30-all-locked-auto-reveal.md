# All Locked Auto-Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a live trivia question automatically shortly after every eligible current-game player has locked an answer.

**Status:** Completed on `feature/all-locked-auto-reveal`; final verification added an atomic DB-side guarded resolve to close a late-participant race found during review.

**Architecture:** Add a pure decision helper, a tiny client scheduling hook, and a narrow host live integration that calls the existing `POST /api/games/:id/end-early` route. The auto path now sends a guarded request to `resolve_question_if_all_locked`, which checks eligibility and resolves inside one database function so a late participant or removal cannot slip between route reads and resolution. Host fallback snapshots include `question_id` in host-only `liveAnswers`; player mode still receives no live answer rows.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase, Vitest, Playwright, npm.

## Global Constraints

- Do not touch production DB.
- Do not deploy.
- Do not change answer validation.
- Do not change scoring rules.
- Do not change `resolve_question` semantics.
- Do not change correct-answer visibility.
- Do not change player submit behavior.
- Do not change Room Magic behavior.
- Final reviewed implementation includes an additive migration file for `resolve_question_if_all_locked`; do not apply it to production outside the DB-first release path.
- The grace window is `1200` ms.
- Zero eligible players is never complete.
- If eligibility cannot be proven, do not auto-reveal.

---

## File Structure

- Create `lib/game/allLockedAutoReveal.ts`: pure helper for eligibility, locked counts, and auto-reveal decision.
- Create `tests/unit/all-locked-auto-reveal.test.ts`: unit tests for decision helper edge cases.
- Create `lib/hooks/useAllLockedAutoReveal.ts`: client hook that schedules one auto-reveal call per question after the grace window.
- Create `tests/unit/useAllLockedAutoReveal.test.tsx`: fake-timer hook tests for schedule, cancel, and one-shot behavior.
- Modify `app/host/live/[nightId]/HostLiveConsoleClient.tsx`: derive auto-reveal decision from current game, live question, active players, `game_scores`, and live answers; call the scheduling hook.
- Modify `app/api/games/[id]/end-early/route.ts`: use the guarded DB RPC when `requireAllLocked` is set.
- Modify `app/api/room/[code]/snapshot/route.ts`: include `question_id` in host-only `liveAnswers` for fallback mode without exposing live answers to players.
- Create `supabase/migrations/0018_resolve_question_if_all_locked.sql`: additive guarded resolve function with service-role-only execute.
- Create `tests/integration/all-locked-auto-reveal-schema.test.ts`: PGlite coverage for the guarded function behavior and grants.
- Create `tests/e2e/all-locked-auto-reveal.spec.ts`: browser rehearsal proving all-locked reveals without test fast-forward and incomplete lock-ins do not reveal early.

The implementation must start from current `origin/main` on a feature branch, not from a detached Room Magic worktree. Recommended branch: `feature/all-locked-auto-reveal`.

---

### Task 1: Pure Auto-Reveal Decision Helper

**Files:**
- Create: `lib/game/allLockedAutoReveal.ts`
- Test: `tests/unit/all-locked-auto-reveal.test.ts`

**Interfaces:**
- Produces:
  - `ALL_LOCKED_AUTO_REVEAL_GRACE_MS: 1200`
  - `deriveAllLockedAutoRevealDecision(input: AllLockedAutoRevealInput): AllLockedAutoRevealDecision`
  - `AllLockedAutoRevealDecision`
  - `AllLockedAutoRevealReason`
- Consumes: none.

- [x] **Step 1: Create the failing helper tests**

Create `tests/unit/all-locked-auto-reveal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveAllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";

const activePlayerIds = ["p1", "p2", "p3"];
const scoreRows = [
  { player_id: "p1" },
  { player_id: "p2" },
  { player_id: "p3" },
];
const lockedAnswers = [
  { question_id: "q1", player_id: "p1" },
  { question_id: "q1", player_id: "p2" },
  { question_id: "q1", player_id: "p3" },
];

describe("deriveAllLockedAutoRevealDecision", () => {
  it("is incomplete without a current game", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: null,
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "no_current_game",
    });
  });

  it("is incomplete without a live question", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: null,
        activePlayerIds,
        scoreRows,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "no_live_question",
    });
  });

  it("is incomplete when eligibility has not loaded", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows: null,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "unknown_eligibility",
    });
  });

  it("is incomplete when there are zero eligible players", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds: [],
        scoreRows: [],
        answers: [],
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "no_eligible_players",
    });
  });

  it("counts only answers for the live question", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: [
          { question_id: "q1", player_id: "p1" },
          { question_id: "q-old", player_id: "p2" },
          { question_id: "q1", player_id: "p3" },
        ],
      }),
    ).toEqual({
      eligibleCount: 3,
      lockedCount: 2,
      complete: false,
      reason: "not_everyone_locked",
    });
  });

  it("deduplicates answer rows by player id defensively", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: [
          { question_id: "q1", player_id: "p1" },
          { question_id: "q1", player_id: "p1" },
          { question_id: "q1", player_id: "p2" },
          { question_id: "q1", player_id: "p3" },
        ],
      }),
    ).toEqual({
      eligibleCount: 3,
      lockedCount: 3,
      complete: true,
    });
  });

  it("ignores removed players and non-participants", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g2",
        liveQuestionId: "q2",
        activePlayerIds: ["p1", "p2"],
        scoreRows: [
          { player_id: "p1" },
          { player_id: "p2" },
          { player_id: "late-game-one-only" },
          { player_id: null },
        ],
        answers: [
          { question_id: "q2", player_id: "p1" },
          { question_id: "q2", player_id: "p2" },
        ],
      }),
    ).toEqual({
      eligibleCount: 2,
      lockedCount: 2,
      complete: true,
    });
  });

  it("returns complete only when every eligible player locked this question", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 3,
      lockedCount: 3,
      complete: true,
    });
  });
});
```

- [x] **Step 2: Run the helper test to verify it fails**

Run:

```bash
npx vitest run tests/unit/all-locked-auto-reveal.test.ts
```

Expected: FAIL because `@/lib/game/allLockedAutoReveal` does not exist.

- [x] **Step 3: Implement the helper**

Create `lib/game/allLockedAutoReveal.ts`:

```ts
export const ALL_LOCKED_AUTO_REVEAL_GRACE_MS = 1200;

export type AllLockedAutoRevealReason =
  | "no_current_game"
  | "no_live_question"
  | "no_eligible_players"
  | "unknown_eligibility"
  | "not_everyone_locked";

export interface AllLockedAutoRevealDecision {
  eligibleCount: number;
  lockedCount: number;
  complete: boolean;
  reason?: AllLockedAutoRevealReason;
}

export interface AllLockedAutoRevealScoreRow {
  player_id: string | null;
}

export interface AllLockedAutoRevealAnswerRow {
  question_id: string | null;
  player_id: string | null;
}

export interface AllLockedAutoRevealInput {
  currentGameId: string | null | undefined;
  liveQuestionId: string | null | undefined;
  activePlayerIds: readonly string[];
  /**
   * Current-game `game_scores` rows. Pass null until the rows are known to be
   * loaded for the current game; an empty array means "loaded, no participants."
   */
  scoreRows: readonly AllLockedAutoRevealScoreRow[] | null;
  answers: readonly AllLockedAutoRevealAnswerRow[];
}

export function deriveAllLockedAutoRevealDecision(
  input: AllLockedAutoRevealInput,
): AllLockedAutoRevealDecision {
  if (!input.currentGameId) {
    return incomplete("no_current_game");
  }
  if (!input.liveQuestionId) {
    return incomplete("no_live_question");
  }
  if (input.scoreRows === null) {
    return incomplete("unknown_eligibility");
  }

  const activePlayers = new Set(input.activePlayerIds.filter(Boolean));
  const eligiblePlayers = new Set<string>();
  for (const row of input.scoreRows) {
    if (row.player_id && activePlayers.has(row.player_id)) {
      eligiblePlayers.add(row.player_id);
    }
  }

  if (eligiblePlayers.size === 0) {
    return incomplete("no_eligible_players");
  }

  const lockedPlayers = new Set<string>();
  for (const answer of input.answers) {
    if (
      answer.question_id === input.liveQuestionId &&
      answer.player_id &&
      eligiblePlayers.has(answer.player_id)
    ) {
      lockedPlayers.add(answer.player_id);
    }
  }

  const complete = lockedPlayers.size === eligiblePlayers.size;
  return {
    eligibleCount: eligiblePlayers.size,
    lockedCount: lockedPlayers.size,
    complete,
    ...(complete ? {} : { reason: "not_everyone_locked" as const }),
  };
}

function incomplete(reason: AllLockedAutoRevealReason): AllLockedAutoRevealDecision {
  return {
    eligibleCount: 0,
    lockedCount: 0,
    complete: false,
    reason,
  };
}
```

- [x] **Step 4: Run the helper test to verify it passes**

Run:

```bash
npx vitest run tests/unit/all-locked-auto-reveal.test.ts
```

Expected: PASS, 8 tests.

- [x] **Step 5: Commit Task 1**

Run:

```bash
git add lib/game/allLockedAutoReveal.ts tests/unit/all-locked-auto-reveal.test.ts
git commit -m "feat: derive all locked auto reveal"
```

---

### Task 2: Auto-Reveal Scheduling Hook

**Files:**
- Create: `lib/hooks/useAllLockedAutoReveal.ts`
- Test: `tests/unit/useAllLockedAutoReveal.test.tsx`

**Interfaces:**
- Consumes:
  - `ALL_LOCKED_AUTO_REVEAL_GRACE_MS`
  - `AllLockedAutoRevealDecision`
- Produces:
  - `useAllLockedAutoReveal(opts: UseAllLockedAutoRevealOpts): void`

- [x] **Step 1: Create the failing hook tests**

Create `tests/unit/useAllLockedAutoReveal.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAllLockedAutoReveal } from "@/lib/hooks/useAllLockedAutoReveal";
import type { AllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";

const completeDecision: AllLockedAutoRevealDecision = {
  eligibleCount: 3,
  lockedCount: 3,
  complete: true,
};

const incompleteDecision: AllLockedAutoRevealDecision = {
  eligibleCount: 3,
  lockedCount: 2,
  complete: false,
  reason: "not_everyone_locked",
};

describe("useAllLockedAutoReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires after the grace window when the decision is complete", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    renderHook(() =>
      useAllLockedAutoReveal({
        questionId: "q1",
        decision: completeDecision,
        onAutoReveal,
      }),
    );

    vi.advanceTimersByTime(1199);
    expect(onAutoReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onAutoReveal).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when the decision is incomplete", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    renderHook(() =>
      useAllLockedAutoReveal({
        questionId: "q1",
        decision: incompleteDecision,
        onAutoReveal,
      }),
    );

    vi.advanceTimersByTime(2000);
    expect(onAutoReveal).not.toHaveBeenCalled();
  });

  it("cancels a pending reveal when completion becomes false", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ decision }) =>
        useAllLockedAutoReveal({
          questionId: "q1",
          decision,
          onAutoReveal,
        }),
      { initialProps: { decision: completeDecision } },
    );

    vi.advanceTimersByTime(600);
    rerender({ decision: incompleteDecision });
    vi.advanceTimersByTime(1000);

    expect(onAutoReveal).not.toHaveBeenCalled();
  });

  it("cancels a pending reveal when the question changes", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ questionId }) =>
        useAllLockedAutoReveal({
          questionId,
          decision: completeDecision,
          onAutoReveal,
        }),
      { initialProps: { questionId: "q1" } },
    );

    vi.advanceTimersByTime(600);
    rerender({ questionId: "q2" });
    vi.advanceTimersByTime(600);
    expect(onAutoReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(onAutoReveal).toHaveBeenCalledTimes(1);
  });

  it("fires at most once for the same question", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ decision }) =>
        useAllLockedAutoReveal({
          questionId: "q1",
          decision,
          onAutoReveal,
        }),
      { initialProps: { decision: completeDecision } },
    );

    vi.advanceTimersByTime(1200);
    rerender({ decision: { ...completeDecision } });
    vi.advanceTimersByTime(1200);

    expect(onAutoReveal).toHaveBeenCalledTimes(1);
  });

  it("can fire again for a new question", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ questionId }) =>
        useAllLockedAutoReveal({
          questionId,
          decision: completeDecision,
          onAutoReveal,
        }),
      { initialProps: { questionId: "q1" } },
    );

    vi.advanceTimersByTime(1200);
    rerender({ questionId: "q2" });
    vi.advanceTimersByTime(1200);

    expect(onAutoReveal).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: Run the hook test to verify it fails**

Run:

```bash
npx vitest run tests/unit/useAllLockedAutoReveal.test.tsx
```

Expected: FAIL because `@/lib/hooks/useAllLockedAutoReveal` does not exist.

- [x] **Step 3: Implement the hook**

Create `lib/hooks/useAllLockedAutoReveal.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import {
  ALL_LOCKED_AUTO_REVEAL_GRACE_MS,
  type AllLockedAutoRevealDecision,
} from "@/lib/game/allLockedAutoReveal";

export interface UseAllLockedAutoRevealOpts {
  questionId: string | null | undefined;
  decision: AllLockedAutoRevealDecision | null;
  onAutoReveal: () => void | Promise<void>;
  graceMs?: number;
}

export function useAllLockedAutoReveal({
  questionId,
  decision,
  onAutoReveal,
  graceMs = ALL_LOCKED_AUTO_REVEAL_GRACE_MS,
}: UseAllLockedAutoRevealOpts): void {
  const onAutoRevealRef = useRef(onAutoReveal);
  const firedQuestionRef = useRef<string | null>(null);

  useEffect(() => {
    onAutoRevealRef.current = onAutoReveal;
  }, [onAutoReveal]);

  useEffect(() => {
    if (!questionId || !decision?.complete) return;
    if (firedQuestionRef.current === questionId) return;

    const handle = window.setTimeout(() => {
      if (firedQuestionRef.current === questionId) return;
      firedQuestionRef.current = questionId;
      void onAutoRevealRef.current();
    }, graceMs);

    return () => window.clearTimeout(handle);
  }, [decision?.complete, graceMs, questionId]);

  useEffect(() => {
    if (!questionId) {
      firedQuestionRef.current = null;
    }
  }, [questionId]);
}
```

- [x] **Step 4: Run the hook test to verify it passes**

Run:

```bash
npx vitest run tests/unit/useAllLockedAutoReveal.test.tsx
```

Expected: PASS, 6 tests.

- [x] **Step 5: Commit Task 2**

Run:

```bash
git add lib/hooks/useAllLockedAutoReveal.ts tests/unit/useAllLockedAutoReveal.test.tsx
git commit -m "feat: schedule all locked auto reveal"
```

---

### Task 3: Host Live Integration

**Files:**
- Modify: `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- Test: covered by Task 1, Task 2, and Task 4.

**Interfaces:**
- Consumes:
  - `deriveAllLockedAutoRevealDecision`
  - `useAllLockedAutoReveal`
  - existing `scores` rows from `game_scores`
  - existing `answers` rows for the live target question
- Produces: host-driven auto-call to existing `handleEndEarly()`.

- [x] **Step 1: Import the helper and hook**

Modify the imports near the existing game/hook imports in `app/host/live/[nightId]/HostLiveConsoleClient.tsx`:

```ts
import { deriveAllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";
import { useAllLockedAutoReveal } from "@/lib/hooks/useAllLockedAutoReveal";
```

- [x] **Step 2: Track when direct score rows are loaded for the current game**

Add state near `directScores`:

```ts
const [directScoresReadyForGameId, setDirectScoresReadyForGameId] =
  useState<string | null>(null);
```

Replace the existing score-loading effect with this version:

```ts
useEffect(() => {
  const gameId = room.currentGame?.id ?? null;
  if (!gameId) {
    setScores([]);
    setDirectScoresReadyForGameId(null);
    return;
  }
  setDirectScoresReadyForGameId(null);
  const supa = getSupabaseBrowser();
  let cancelled = false;
  async function load() {
    const { data } = await supa
      .from("game_scores")
      .select("*")
      .eq("game_id", gameId)
      .order("score", { ascending: false });
    if (cancelled) return;
    setScores(((data as GameScoreRow[] | null) ?? []));
    setDirectScoresReadyForGameId(gameId);
  }
  void load();
  const channel = supa
    .channel(`host-scores:${gameId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "answers" },
      () => void load(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "adjustments" },
      () => void load(),
    )
    .subscribe();
  return () => {
    cancelled = true;
    void supa.removeChannel(channel);
  };
}, [room.currentGame?.id]);
```

- [x] **Step 3: Derive the auto-reveal decision**

After `const currentGame: GameRow | null = room.currentGame;`, add:

```ts
const scoresReadyForGameId =
  backupMode && fallbackPayload
    ? currentGame?.id ?? null
    : directScoresReadyForGameId;

const allLockedAutoRevealDecision = useMemo(
  () =>
    deriveAllLockedAutoRevealDecision({
      currentGameId: currentGame?.id ?? null,
      liveQuestionId: room.currentQuestion?.id ?? null,
      activePlayerIds: room.players.map((p) => p.id),
      scoreRows:
        currentGame && scoresReadyForGameId === currentGame.id
          ? scores
          : null,
      answers,
    }),
  [
    answers,
    currentGame,
    room.currentQuestion?.id,
    room.players,
    scores,
    scoresReadyForGameId,
  ],
);
```

- [x] **Step 4: Schedule the host auto-reveal**

Place this hook call after `handleEndEarly` is in lexical scope and before the component `return`:

```ts
useAllLockedAutoReveal({
  questionId: room.currentQuestion?.id ?? null,
  decision: allLockedAutoRevealDecision,
  onAutoReveal: handleEndEarly,
});
```

If the file order makes that placement awkward, move the existing action handler function declarations above the derived `game1Id`/`game2Id` block. Do not move hooks into conditions.

- [x] **Step 5: Use the eligible count in the host strip while a question is live**

Change the props passed to `<HostLiveConsole />` so the denominator matches current-game eligibility when known:

```tsx
playersTotal={
  room.currentQuestion && allLockedAutoRevealDecision.eligibleCount > 0
    ? allLockedAutoRevealDecision.eligibleCount
    : room.players.length
}
lockedCount={
  room.currentQuestion
    ? allLockedAutoRevealDecision.lockedCount
    : answers.length
}
```

- [x] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx
```

Expected: PASS.

- [x] **Step 7: Commit Task 3**

Run:

```bash
git add app/host/live/[nightId]/HostLiveConsoleClient.tsx
git commit -m "feat: auto reveal when all players lock"
```

---

### Task 4: All-Locked Browser Rehearsal

**Files:**
- Create: `tests/e2e/all-locked-auto-reveal.spec.ts`

**Interfaces:**
- Consumes:
  - `loginAsHost`
  - `seedNight`
  - `startGame`
  - `openHostLive`
  - `revealQuestion`
  - `fastForwardTimer`
  - `listQuestionsInCategory`
  - `resetTestData`
  - `joinPhone`
  - `tapAnswerSlot`
  - `awaitReveal`
  - `openTV`
  - `waitForQuestionOnTV`
  - `waitForRevealOnTV`

- [x] **Step 1: Create the E2E spec**

Create `tests/e2e/all-locked-auto-reveal.spec.ts`:

```ts
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  fastForwardTimer,
  listQuestionsInCategory,
  loginAsHost,
  openHostLive,
  resetTestData,
  revealQuestion,
  seedNight,
  startGame,
  type SeededNight,
} from "./helpers/host-laptop";
import { awaitReveal, joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";
import { openTV, waitForQuestionOnTV, waitForRevealOnTV } from "./helpers/tv";

test.describe.configure({ mode: "serial" });

test.describe("all locked auto-reveal", () => {
  test.setTimeout(180_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;
  let p2: BrowserContext;
  let p3: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p3 = await browser.newContext({ viewport: { width: 390, height: 844 } });

    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    try {
      if (host) {
        const cleanup = await host.newPage();
        await resetTestData(cleanup);
        await cleanup.close();
      }
    } catch {
      // Already-closed contexts should not fail cleanup.
    }
    await Promise.all(
      [host, tv, p1, p2, p3]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("reveals automatically after every eligible player locks", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const { questionId } = await setupLiveQuestion({
      hostPage,
      tvPage,
      phone1,
      phone2,
      phone3,
      emailPrefix: "all-locked",
    });

    await Promise.all([
      tapAnswerSlot(phone1, 1),
      tapAnswerSlot(phone2, 2),
      tapAnswerSlot(phone3, 3),
    ]);

    await Promise.all([
      waitForRevealOnTV(tvPage, 12_000),
      awaitReveal(phone1, 12_000),
      awaitReveal(phone2, 12_000),
      awaitReveal(phone3, 12_000),
    ]);

    const snapshot = await tvPage.request.get(`/api/tv/${seed.roomCode}/snapshot`);
    expect(snapshot.ok()).toBe(true);
    const body = (await snapshot.json()) as { targetQuestionId: string | null };
    expect(body.targetQuestionId).toBe(questionId);

    await pageCloseAll(hostPage, tvPage, phone1, phone2, phone3);
  });

  test("keeps the question live while one eligible player has not answered", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const { seed, questionId } = await setupLiveQuestion({
      hostPage,
      tvPage,
      phone1,
      phone2,
      phone3,
      emailPrefix: "not-all-locked",
    });

    await Promise.all([
      tapAnswerSlot(phone1, 1),
      tapAnswerSlot(phone2, 2),
    ]);

    await tvPage.waitForTimeout(3000);
    await expect(tvPage.getByTestId(TID.tvQuestion.root)).toBeVisible();
    await expect(tvPage.getByTestId(TID.tvReveal.root)).toHaveCount(0);
    await expect(phone3.getByTestId(TID.playerQuestion.root)).toBeVisible();

    await fastForwardTimer(hostPage, questionId);
    await Promise.all([
      waitForRevealOnTV(tvPage, 10_000),
      awaitReveal(phone1, 10_000),
      awaitReveal(phone2, 10_000),
      awaitReveal(phone3, 10_000),
    ]);

    await pageCloseAll(hostPage, tvPage, phone1, phone2, phone3);
  });
});

async function setupLiveQuestion({
  hostPage,
  tvPage,
  phone1,
  phone2,
  phone3,
  emailPrefix,
}: {
  hostPage: Page;
  tvPage: Page;
  phone1: Page;
  phone2: Page;
  phone3: Page;
  emailPrefix: string;
}): Promise<{ seed: SeededNight; questionId: string }> {
  const { hostId } = await loginAsHost(
    hostPage,
    `${emailPrefix}-${Date.now()}@tr1via.test`,
  );
  const seed = await seedNight(hostPage, hostId);

  await openTV(tvPage, seed.roomCode);
  await joinPhone(phone1, seed.roomCode, "Alex");
  await joinPhone(phone2, seed.roomCode, "Brooke");
  await joinPhone(phone3, seed.roomCode, "Casey");
  await openHostLive(hostPage, seed.nightId);
  await startGame(hostPage, seed.game1.id);

  const category = seed.categories[0];
  if (!category) throw new Error("seed did not include categories");
  const questionId = listQuestionsInCategory(seed, category.id)[0];
  if (!questionId) throw new Error("seed did not include question ids");

  await revealQuestion(hostPage, questionId);
  await Promise.all([
    waitForQuestionOnTV(tvPage, 10_000),
    expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
    expect(phone2.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
    expect(phone3.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
  ]);

  return { seed, questionId };
}

async function pageCloseAll(...pages: Page[]): Promise<void> {
  await Promise.all(pages.map((page) => page.close().catch(() => {})));
}
```

- [x] **Step 2: Run the new E2E spec**

Run:

```bash
npm run test:e2e -- tests/e2e/all-locked-auto-reveal.spec.ts
```

Expected: PASS, 2 tests.

- [x] **Step 3: Commit Task 4**

Run:

```bash
git add tests/e2e/all-locked-auto-reveal.spec.ts
git commit -m "test: cover all locked auto reveal"
```

---

### Task 5: Regression Verification and Branch Review

**Files:**
- Modify only if verification exposes a branch-caused failure.

**Interfaces:**
- Consumes the completed feature from Tasks 1-4.
- Produces a branch ready for code review.

- [x] **Step 1: Run focused unit tests**

Run:

```bash
npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run all unit/component/integration tests**

Run:

```bash
npm test
```

Expected: PASS. If a baseline failure appears, confirm whether it matches the known `HostHomeClient-founder-build.test.tsx` type-check noise before treating it as branch-caused.

- [x] **Step 3: Run browser coverage**

Run:

```bash
npm run test:e2e -- tests/e2e/all-locked-auto-reveal.spec.ts tests/e2e/reveal-sync.spec.ts
```

Expected: PASS. `all-locked-auto-reveal.spec.ts` proves the new pacing behavior. `reveal-sync.spec.ts` proves the existing one-press contract still works.

- [x] **Step 4: Run production build locally**

Run:

```bash
npm run build
```

Expected: PASS.

- [x] **Step 5: Run changed-file lint directly**

Run:

```bash
npx eslint \
  app/api/games/[id]/end-early/route.ts \
  app/api/room/[code]/snapshot/route.ts \
  lib/game/allLockedAutoReveal.ts \
  lib/hooks/useAllLockedAutoReveal.ts \
  lib/api/schemas.ts \
  lib/supabase/types.ts \
  tests/unit/all-locked-auto-reveal.test.ts \
  tests/unit/useAllLockedAutoReveal.test.tsx \
  tests/unit/api-end-early-route.test.ts \
  tests/unit/api-room-snapshot-route.test.ts \
  tests/integration/all-locked-auto-reveal-schema.test.ts \
  tests/e2e/all-locked-auto-reveal.spec.ts
```

Expected: PASS. Use direct ESLint because the repo's `npm run lint` script is known to be incompatible with Next 16.

Final verification note: the repo still has pre-existing React hook lint noise
inside `HostLiveConsoleClient.tsx`. The branch-specific final lint gate used
direct ESLint on the changed route/helper/hook/test files that are clean, plus
`npm run build`, focused Vitest, full Vitest, and browser E2E.

- [x] **Step 6: Run diff hygiene**

Run:

```bash
git diff --check origin/main...HEAD
git status -sb
```

Expected: `git diff --check` exits 0. `git status -sb` shows only intentional committed branch changes plus any known unrelated untracked file that existed before this work.

- [x] **Step 7: Request review**

Use the `superpowers:requesting-code-review` skill for an implementation review before PR or merge. The review prompt must include:

```text
Review All Locked Auto-Reveal v1. Focus on eligibility math, one-shot scheduling, race safety with timer-zero resolve, and whether any path could reveal before all current-game participants have locked.
```

- [x] **Step 8: Final commit if verification required changes**

If verification required code changes, commit them:

```bash
git add app/host/live/[nightId]/HostLiveConsoleClient.tsx lib/game/allLockedAutoReveal.ts lib/hooks/useAllLockedAutoReveal.ts tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx tests/e2e/all-locked-auto-reveal.spec.ts
git commit -m "fix: harden all locked auto reveal"
```

If no changes were required, do not create an empty commit.

---

## Review Checklist

- The feature uses existing `POST /api/games/:id/end-early`.
- The feature does not call `resolve_question` directly from the client.
- The feature adds an additive guarded-resolve migration and must use the DB-first release path before production app rollout.
- The feature does not expose `game_participations` to player mode.
- The helper treats zero eligible players as incomplete.
- The helper treats unloaded score rows as `unknown_eligibility`.
- The hook schedules exactly one call per question.
- The hook cancels on incomplete state or question change.
- The E2E all-locked test does not call `fastForwardTimer`.
- The E2E incomplete-lock test proves the live question remains visible before manual or timer-zero reveal.
