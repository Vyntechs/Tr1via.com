// Player phone helpers. Each phone is its own BrowserContext so the device
// cookie is isolated — three phones in three contexts get three player rows.

import { expect, type Page } from "@playwright/test";
import { TID } from "./selectors";

// PalettePeekProvider auto-opens its "pick a palette" modal 2s after the
// player lands for the very first time, gated on this localStorage key.
// Pre-setting it suppresses the modal so it can't intercept join/answer clicks.
const PALETTE_PEEK_FLAG_SCRIPT =
  "try { localStorage.setItem('tr1via:peeked-v1', '1'); } catch {}";

/**
 * A phone joins the room with the given display name. Lands on PlayerLobby.
 */
export async function joinPhone(page: Page, roomCode: string, name: string): Promise<void> {
  // Suppress the first-visit palette egg modal before any page script runs.
  await page.addInitScript(PALETTE_PEEK_FLAG_SCRIPT);
  await page.goto(`/join?code=${roomCode}`);
  const input = page.getByTestId(TID.playerJoin.input);
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(name);
  await page.getByTestId(TID.playerJoin.submit).click();
  // Generous: first POST /api/players + first room snapshot can be slow.
  await expect(page.getByTestId(TID.playerLobby.root)).toBeVisible({ timeout: 60_000 });
}

/**
 * Tap one of the four answer slots (1-4, as the player sees them). Asserts
 * the phone transitions to the Locked screen.
 */
export async function tapAnswerSlot(page: Page, slot: 1 | 2 | 3 | 4): Promise<void> {
  await page.getByTestId(TID.playerQuestion.answer(slot)).click();
  await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 3000 });
}

/**
 * Wait for either the Correct or Wrong reveal screen.
 */
export async function awaitReveal(page: Page, timeoutMs = 3000): Promise<void> {
  await expect(async () => {
    const c = page.getByTestId(TID.playerRevealCorrect.root);
    const w = page.getByTestId(TID.playerRevealWrong.root);
    const visible = (await c.isVisible()) || (await w.isVisible());
    expect(visible).toBe(true);
  }).toPass({ timeout: timeoutMs });
}
