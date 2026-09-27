// host-sign-in-codes.spec.ts — signed-out doors of the email-first /login.
//
// Covers: an account with no password gets an emailed code; 5 wrong tries
// lock the code; an expired code is refused; password sign-in; "Forgot
// password?"; a brand-new host must prove the email with a code; and the
// old email-only doors are closed.
//
// LOCAL ONLY. The code email goes out over SMTP (lib/email/send-code-email.ts),
// so this spec needs the local SMTP sink (tests/e2e/helpers/smtp-sink.mjs)
// and a dev server started with the redirect preload — see the sink's header.
// Skips unless E2E_SMTP_SINK_URL is set and a local service-role key exists.

import { test, expect, type Page } from "@playwright/test";
import { loginAsHost, resetTestData } from "./helpers/host-laptop";
import { TID } from "./helpers/selectors";
import { getAuthUser, localAdminOrNull, makeLegacyAccount } from "./helpers/supabase-admin";

const SINK = process.env.E2E_SMTP_SINK_URL;
const admin = localAdminOrNull();
const RUN = Date.now();
const email = (tag: string) => `code-${tag}-${RUN}@tr1via.test`;
const PASSWORD = `Quiz-Master-${RUN}`;

async function latestCode(to: string, notBefore: string): Promise<string> {
  let found: string | null = null;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${SINK}/latest?to=${encodeURIComponent(to)}`);
        if (!res.ok) return null;
        const m = (await res.json()) as { code: string | null; receivedAt: string };
        found = m.receivedAt >= notBefore ? m.code : null;
        return found;
      },
      { timeout: 15_000, message: `no code email for ${to}` },
    )
    .not.toBeNull();
  return found!;
}

/** A host account made before passwords existed (hosts row, no marker). */
async function legacyHost(page: Page, addr: string): Promise<string> {
  const { userId } = await loginAsHost(page, addr, "Legacy Host");
  await page.context().clearCookies();
  const u = await makeLegacyAccount(admin!, userId);
  expect(u.app_metadata?.password_set_at ?? null).toBeNull();
  return userId;
}

async function typeCode(page: Page, code: string) {
  await page.getByTestId("login-code-input").fill(code, { force: true });
}

test.describe.configure({ mode: "serial" });

test.describe("email-first sign-in — codes, passwords, closed doors", () => {
  test.skip(!SINK || !admin, "needs E2E_SMTP_SINK_URL + a LOCAL Supabase service-role key");
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await resetTestData(page);
    await ctx.close();
    // Keep the site-wide hourly code cap from tripping across local reruns.
    await admin!.from("auth_email_codes").delete().like("email", "%@tr1via.test");
    // Same for the per-IP / wrong-password limits (every local run is one
    // IP). The table only exists once its migration is applied locally;
    // without it the limits fail open, so a missing table is fine here.
    await admin!.from("auth_rate_events").delete().gte("created_at", "1970-01-01T00:00:00Z");
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await resetTestData(page).catch(() => {});
    await ctx.close();
  });

  test("no-password account: email → emailed code → create password → /host", async ({ page }) => {
    const addr = email("legacy");
    const userId = await legacyHost(page, addr);
    const since = new Date().toISOString();

    await page.goto("/login");
    await page.getByLabel("Email").fill(addr);
    await page.getByTestId(TID.login.submit).click();
    await expect(page.getByTestId("login-code-sent")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("STEP 1 OF 2 · CHECK YOUR EMAIL")).toBeVisible();
    // No password box for an account that has none.
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);

    await typeCode(page, await latestCode(addr, since));
    await expect(page).toHaveURL(/\/host\/set-password\?from=code&next=%2Fhost$/, { timeout: 30_000 });
    await expect(page.getByTestId("set-password-step")).toHaveText("STEP 2 OF 2 · CREATE YOUR PASSWORD");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Type it again").fill(PASSWORD);
    await page.getByTestId("set-password-submit").click();
    await page.getByTestId("set-password-continue").click();
    await expect(page).toHaveURL(/\/host$/, { timeout: 30_000 });
    expect(typeof (await getAuthUser(admin!, userId)).app_metadata?.password_set_at).toBe("string");

    // Next time: the password step, not a code.
    await page.context().clearCookies();
    const res = await page.request.post("/api/auth/start", { data: { email: addr } });
    expect(await res.json()).toEqual({ step: "password" });
  });

  test("5 wrong tries lock the code; the right code is refused after", async ({ page }) => {
    const addr = email("lock");
    await legacyHost(page, addr);
    const since = new Date().toISOString();
    const start = await page.request.post("/api/auth/start", { data: { email: addr } });
    expect((await start.json()).step).toBe("code");
    const good = await latestCode(addr, since);
    const wrong = good === "000000" ? "111111" : "000000";

    const tries: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await page.request.post("/api/auth/verify-code", {
        data: { email: addr, purpose: "login", code: wrong },
      });
      tries.push(`${r.status()}:${(await r.json()).code}`);
    }
    expect(tries).toEqual([
      "400:wrong_code",
      "400:wrong_code",
      "400:wrong_code",
      "400:wrong_code",
      "429:code_locked",
    ]);
    const after = await page.request.post("/api/auth/verify-code", {
      data: { email: addr, purpose: "login", code: good },
    });
    expect(after.status()).toBe(429);
    expect((await after.json()).code).toBe("code_locked");
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  });

  test("an expired code is refused", async ({ page }) => {
    const addr = email("expired");
    await legacyHost(page, addr);
    const since = new Date().toISOString();
    await page.request.post("/api/auth/start", { data: { email: addr } });
    const good = await latestCode(addr, since);
    const { error } = await admin!
      .from("auth_email_codes")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("email", addr);
    expect(error).toBeNull();
    const r = await page.request.post("/api/auth/verify-code", {
      data: { email: addr, purpose: "login", code: good },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe("code_expired");
  });

  test("password sign-in, wrong password, and forgot password", async ({ page }) => {
    const addr = email("pw");
    await loginAsHost(page, addr, "Password Host", PASSWORD);
    await page.context().clearCookies();

    const bad = await page.request.post("/api/auth/login", {
      data: { email: addr, password: "not-the-password" },
    });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).code).toBe("wrong_password");

    await page.goto("/login");
    await page.getByLabel("Email").fill(addr);
    await page.getByTestId(TID.login.submit).click();
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByTestId(TID.login.submit).click();
    await expect(page).toHaveURL(/\/host$/, { timeout: 30_000 });

    // Forgot password: code → new password → old one stops working.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(addr);
    await page.getByTestId(TID.login.submit).click();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    const since = new Date().toISOString();
    await page.getByTestId("login-forgot").click();
    await expect(page.getByText("RESET YOUR PASSWORD · CHECK YOUR EMAIL")).toBeVisible({ timeout: 30_000 });
    await typeCode(page, await latestCode(addr, since));
    await expect(page).toHaveURL(/\/host\/set-password\?from=reset&next=%2Fhost$/, { timeout: 30_000 });
    const NEW = `${PASSWORD}-new`;
    await page.getByLabel("Password", { exact: true }).fill(NEW);
    await page.getByLabel("Type it again").fill(NEW);
    await page.getByTestId("set-password-submit").click();
    await page.getByTestId("set-password-continue").click();
    await expect(page).toHaveURL(/\/host$/, { timeout: 30_000 });

    await page.context().clearCookies();
    const old = await page.request.post("/api/auth/login", { data: { email: addr, password: PASSWORD } });
    expect(old.status()).toBe(401);
    const ok = await page.request.post("/api/auth/login", { data: { email: addr, password: NEW } });
    expect(ok.status()).toBe(200);
  });

  test("new host: password, then a code proves the email, then onboarding", async ({ page }) => {
    const addr = email("new");

    // A wrong code never creates an account.
    const early = await page.request.post("/api/auth/host-access", {
      data: { email: addr, password: PASSWORD, confirm: PASSWORD, code: "123456" },
    });
    expect(early.status()).toBe(400);
    expect((await page.request.post("/api/auth/start", { data: { email: addr } }).then((r) => r.json())).step)
      .toBe("signup");

    await page.goto("/login");
    await page.getByLabel("Email").fill(addr);
    await page.getByTestId(TID.login.submit).click();
    await expect(page.getByText("STEP 1 OF 2 · CREATE YOUR PASSWORD")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Type it again").fill(PASSWORD);
    const since = new Date().toISOString();
    await page.getByTestId(TID.login.submit).click();
    await expect(page.getByText("STEP 2 OF 2 · CHECK YOUR EMAIL")).toBeVisible({ timeout: 30_000 });
    await typeCode(page, await latestCode(addr, since));
    await expect(page).toHaveURL(/\/host(\/onboarding)?$/, { timeout: 30_000 });

    await page.context().clearCookies();
    const signIn = await page.request.post("/api/auth/login", { data: { email: addr, password: PASSWORD } });
    expect(signIn.status()).toBe(200);
  });

  test("old email-only doors are closed", async ({ page }) => {
    const legacy = email("doors");
    await legacyHost(page, legacy);

    // The old email-only founder door is gone.
    const founderLogin = await page.request.post("/api/auth/founder-login", { data: { email: legacy } });
    expect(founderLogin.status()).toBe(404);

    // host-access used to sign in any known email with just the address.
    const hostAccess = await page.request.post("/api/auth/host-access", { data: { email: legacy } });
    expect(hostAccess.status()).toBe(400);

    // A no-password account can't sign in with a guessed password.
    const guess = await page.request.post("/api/auth/login", {
      data: { email: legacy, password: "whatever-123" },
    });
    expect(guess.status()).toBe(403);
    expect((await guess.json()).code).toBe("no_password");

    // A password account can't be downgraded to an emailed login code.
    const pwAddr = email("doors-pw");
    await loginAsHost(page, pwAddr, "PW Host", PASSWORD);
    await page.context().clearCookies();
    const loginCode = await page.request.post("/api/auth/send-code", {
      data: { email: pwAddr, purpose: "login" },
    });
    expect(loginCode.status()).toBe(409);

    // None of the above left a session behind.
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
    await page.goto("/host");
    await expect(page).toHaveURL(/\/login\?next=%2Fhost$/);
  });
});
