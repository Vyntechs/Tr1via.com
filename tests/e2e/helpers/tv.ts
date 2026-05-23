// Venue TV helpers. The TV is the read-only "big screen" in the room — no
// auth, no input. It subscribes to room:{code} broadcasts and re-renders.

import { expect, type Page } from "@playwright/test";
import { TID } from "./selectors";

/**
 * Open the venue TV at a given room code. Lands on TVLobby initially.
 */
export async function openTV(page: Page, roomCode: string): Promise<void> {
  await page.goto(`/tv/${roomCode}`);
  // Generous on first nav: Turbopack cold-compile + remote Supabase snapshot.
  await expect(page.getByTestId(TID.tvLobby.root)).toBeVisible({ timeout: 30_000 });
}

/**
 * Wait until the TV's question screen is showing.
 */
export async function waitForQuestionOnTV(page: Page, timeoutMs = 3000): Promise<void> {
  await expect(page.getByTestId(TID.tvQuestion.root)).toBeVisible({ timeout: timeoutMs });
}

/**
 * Wait until the TV's reveal screen is showing.
 */
export async function waitForRevealOnTV(page: Page, timeoutMs = 3000): Promise<void> {
  await expect(page.getByTestId(TID.tvReveal.root)).toBeVisible({ timeout: timeoutMs });
}
