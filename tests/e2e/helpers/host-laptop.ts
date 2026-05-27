// Host-laptop helpers for the multi-context Playwright tests.
//
// Every helper that hits an /api/_test/* route attaches the x-test-secret
// header. The header value matches the TEST_SECRET env var the dev server
// boots with (see playwright.config.ts → webServer.env).
//
// loginAsHost is paranoid about email format — it refuses any address not
// ending in @tr1via.test. The server-side route enforces the same allowlist;
// duplicating it in the helper means a typo in a test surfaces as an
// immediate JS error instead of a 400 from the API.

import { expect, type Page } from "@playwright/test";
import { TID } from "./selectors";
import { TEST_SECRET } from "./env";

/**
 * Sign in as a host using /api/_test/login. Email MUST end in @tr1via.test.
 * Returns the hostId for use in seedNight().
 */
export async function loginAsHost(
  page: Page,
  email: string,
  displayName = "Test Host",
): Promise<{ hostId: string; userId: string }> {
  if (!email.endsWith("@tr1via.test")) {
    throw new Error(`loginAsHost: email must end in @tr1via.test, got ${email}`);
  }
  const res = await page.request.post("/api/_test/login", {
    headers: { "x-test-secret": TEST_SECRET },
    data: { email, displayName },
  });
  if (!res.ok()) {
    throw new Error(`loginAsHost failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { hostId: string; userId: string };
  return { hostId: body.hostId, userId: body.userId };
}

/** Shape returned by POST /api/_test/seed-night. */
export interface SeededCategory {
  id: string;
  name: string;
  position: number;
  /** Picked question ids sorted ascending by point_value (100..700). */
  question_ids: string[];
}

export interface SeededNight {
  nightId: string;
  roomCode: string;
  game1: { id: string; game_no: number; state: string };
  game2: { id: string; game_no: number; state: string };
  categories: SeededCategory[];
  /** Populated only when scenario === "two-games-ready". */
  game2Categories: SeededCategory[];
}

export interface SeedNightOptions {
  scenario?: "happy-path-3-cats-game1" | "two-games-ready" | "empty-night";
  /** ThemeKey to apply to the night. Defaults to "house". */
  themeKey?: string;
}

/**
 * Create a fully-realized night via /api/_test/seed-night. Default scenario
 * gives game 1 with 3 categories of 7 picked questions each. Each returned
 * category includes question_ids sorted ascending by point_value, so tests
 * can drive reveals without a follow-up fetch.
 *
 * Accepts either:
 *   seedNight(page, hostId, scenario)            — legacy positional form
 *   seedNight(page, hostId, { scenario, themeKey }) — options object form
 */
export async function seedNight(
  page: Page,
  hostId: string,
  scenarioOrOptions?:
    | "happy-path-3-cats-game1"
    | "two-games-ready"
    | "empty-night"
    | SeedNightOptions,
): Promise<SeededNight> {
  let scenario: SeedNightOptions["scenario"] = "happy-path-3-cats-game1";
  let themeKey: string | undefined;

  if (typeof scenarioOrOptions === "string") {
    scenario = scenarioOrOptions;
  } else if (scenarioOrOptions !== undefined) {
    scenario = scenarioOrOptions.scenario ?? "happy-path-3-cats-game1";
    themeKey = scenarioOrOptions.themeKey;
  }

  const res = await page.request.post("/api/_test/seed-night", {
    headers: { "x-test-secret": TEST_SECRET },
    data: { hostId, scenario, ...(themeKey !== undefined ? { themeKey } : {}) },
  });
  if (!res.ok()) {
    throw new Error(`seedNight failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as SeededNight;
}

/**
 * Wipe all @tr1via.test users + cascading data. Call in afterAll() to keep
 * prod clean. Safe to call when there's nothing to delete.
 */
export async function resetTestData(page: Page): Promise<void> {
  await page.request.post("/api/_test/reset", {
    headers: { "x-test-secret": TEST_SECRET },
  });
}

/**
 * Open the host's live console for a given night.
 */
export async function openHostLive(page: Page, nightId: string): Promise<void> {
  await page.goto(`/host/live/${nightId}`);
  // Generous: /host pages route through auth middleware + first compile is slow.
  await expect(page.getByTestId(TID.hostLiveConsole.root)).toBeVisible({ timeout: 30_000 });
}

/**
 * Transition a game to the "live" state. Reveals require this — the TV's
 * state machine treats "ready" games as still-in-lobby and the question
 * screen won't render until the game is "live". The page param supplies
 * the auth cookies (host is logged in on it).
 */
export async function startGame(page: Page, gameId: string): Promise<void> {
  const res = await page.request.post(`/api/games/${gameId}/start`);
  if (!res.ok()) {
    throw new Error(`startGame failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Reveal a specific question via the UI cell click. Asserts the cell exists
 * then clicks. Use for one-off reveal tests where exercising the UI path
 * matters (e.g. reveal-sync.spec.ts).
 */
export async function revealQuestion(page: Page, questionId: string): Promise<void> {
  const cell = page.getByTestId(TID.hostLiveConsole.question(questionId));
  await expect(cell).toBeVisible();
  await cell.click();
}

/**
 * Reveal a specific question via direct API POST. Used by full-game tests
 * where chaining 28 UI reveals would be slow + brittle (host cells flip
 * between clickable/disabled states based on snapshot freshness).
 */
export async function revealViaApi(
  page: Page,
  gameId: string,
  questionId: string,
): Promise<void> {
  const res = await page.request.post(`/api/games/${gameId}/reveal`, {
    data: { questionId },
  });
  if (!res.ok()) {
    throw new Error(`revealViaApi failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * End a game via POST /api/games/:id/end. The TV transitions from leaderboard
 * to intermission (game 1) or finale (game 2). After this call, no new
 * answers can be inserted.
 */
export async function endGame(page: Page, gameId: string): Promise<void> {
  const res = await page.request.post(`/api/games/${gameId}/end`);
  if (!res.ok()) {
    throw new Error(`endGame failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Fast-forward a live question's timer. Calls /api/_test/fast-forward which
 * internally invokes the production resolve route — same code path as the
 * 20-second timer expiring naturally.
 */
export async function fastForwardTimer(page: Page, questionId: string): Promise<void> {
  const res = await page.request.post("/api/_test/fast-forward", {
    headers: { "x-test-secret": TEST_SECRET },
    data: { questionId },
  });
  if (!res.ok()) {
    throw new Error(`fastForwardTimer failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Return the picked question ids for a category, ordered ascending by
 * point_value (so questionIds[0] is the 100-pointer). Sourced from the
 * SeededNight returned by seedNight() — no network call needed.
 */
export function listQuestionsInCategory(seed: SeededNight, categoryId: string): string[] {
  const cat = seed.categories.find((c) => c.id === categoryId);
  if (!cat) throw new Error(`listQuestionsInCategory: no category ${categoryId} in seed`);
  return [...cat.question_ids];
}
