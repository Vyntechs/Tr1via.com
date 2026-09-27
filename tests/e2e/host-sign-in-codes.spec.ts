// host-sign-in-codes.spec.ts — signed-out doors of the email-first /login.
//
// Covers: an account with no password gets an emailed code; while one of
// her nights is running a code sign-in skips the password step (and saving
// is refused), after the show she's asked, with "Not now"; one stranger's
// network can't lock her code, but 10 wrong tries from anywhere lock it;
// an expired code is refused; password sign-in; "Forgot
// password?"; a brand-new host must prove the email with a code; and the
// old email-only doors are closed.
//
// LOCAL ONLY. The code email goes out over SMTP (lib/email/send-code-email.ts),
// so this spec needs the local SMTP sink (tests/e2e/helpers/smtp-sink.mjs)
// and a dev server started with the redirect preload — see the sink's header.
// Skips unless E2E_SMTP_SINK_URL is set and a local service-role key exists.

import { test, expect, type Page } from "@playwright/test";
import { loginAsHost, resetTestData, seedNight } from "./helpers/host-laptop";
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

  test("one stranger's wrong guesses can't lock her code; 10 wrong tries from anywhere do", async ({ page }) => {
    const addr = email("lock");
    await legacyHost(page, addr);
    const since = new Date().toISOString();
    const start = await page.request.post("/api/auth/start", { data: { email: addr } });
    expect((await start.json()).step).toBe("code");
    const good = await latestCode(addr, since);
    const wrong = good === "000000" ? "111111" : "000000";
    const guess = async (ip: string, code: string) => {
      const r = await page.request.post("/api/auth/verify-code", {
        headers: { "x-real-ip": ip },
        data: { email: addr, purpose: "login", code },
      });
      return `${r.status()}:${(await r.json()).code}`;
    };

    // Stranger A: 5 wrong tries, then this network is told to wait.
    const a: string[] = [];
    for (let i = 0; i < 6; i++) a.push(await guess("203.0.113.61", wrong));
    expect(a).toEqual([...Array(5).fill("400:wrong_code"), "429:too_many_wrong_codes"]);
    // Stranger B (another network) uses the other 5 tries: now the code is locked.
    const b: string[] = [];
    for (let i = 0; i < 5; i++) b.push(await guess("203.0.113.62", wrong));
    expect(b).toEqual([...Array(4).fill("400:wrong_code"), "429:code_locked"]);
    expect(await guess("198.51.100.8", good)).toBe("429:code_locked");
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);

    // A fresh code is still allowed, and works from her own network.
    const since2 = new Date().toISOString();
    const again = await page.request.post("/api/auth/start", {
      headers: { "x-real-ip": "198.51.100.8" },
      data: { email: addr },
    });
    expect(again.status()).toBe(200);
    expect(await guess("198.51.100.8", await latestCode(addr, since2))).toBe("200:undefined");
  });

  test("one stranger's wrong guesses don't stop her own code working", async ({ page }) => {
    const addr = email("stranger");
    await legacyHost(page, addr);
    const since = new Date().toISOString();
    await page.request.post("/api/auth/start", { headers: { "x-real-ip": "198.51.100.9" }, data: { email: addr } });
    const good = await latestCode(addr, since);
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 8; i++) {
      await page.request.post("/api/auth/verify-code", {
        headers: { "x-real-ip": "203.0.113.70" },
        data: { email: addr, purpose: "login", code: wrong },
      });
    }
    const r = await page.request.post("/api/auth/verify-code", {
      headers: { "x-real-ip": "198.51.100.9" },
      data: { email: addr, purpose: "login", code: good },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test("show running: a code sign-in skips the password step; after the show she's asked, with 'Not now'", async ({
    page,
  }) => {
    const addr = email("show");
    const { hostId, userId } = await loginAsHost(page, addr, "Show Host");
    const night = await seedNight(page, hostId, "empty-night");
    await page.context().clearCookies();
    await makeLegacyAccount(admin!, userId);
    // Her night is open (running) right now.
    const opened = await admin!
      .from("nights")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", night.nightId);
    expect(opened.error).toBeNull();

    const signInByCode = async () => {
      const since = new Date().toISOString();
      await page.goto("/login");
      await page.getByLabel("Email").fill(addr);
      await page.getByTestId(TID.login.submit).click();
      await expect(page.getByTestId("login-code-sent")).toBeVisible({ timeout: 30_000 });
      await typeCode(page, await latestCode(addr, since));
    };

    await signInByCode();
    // Straight in — no "Create your password" mid-show.
    await expect(page).toHaveURL(/\/host$/, { timeout: 30_000 });
    await expect(page.getByTestId("set-password-screen")).toHaveCount(0);
    const refused = await page.request.post("/api/auth/set-password", {
      data: { password: PASSWORD, confirm: PASSWORD },
    });
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).code).toBe("show_running");
    expect((await getAuthUser(admin!, userId)).app_metadata?.password_set_at ?? null).toBeNull();

    // After the show, her next sign-in walks her to the password step…
    const closed = await admin!
      .from("nights")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", night.nightId);
    expect(closed.error).toBeNull();
    await page.context().clearCookies();
    await signInByCode();
    await expect(page).toHaveURL(/\/host\/set-password\?from=code&next=%2Fhost$/, { timeout: 30_000 });
    // …with a clear "Not now" that goes to /host.
    await page.getByTestId("set-password-later").click();
    await expect(page).toHaveURL(/\/host$/, { timeout: 30_000 });
    await expect(page.getByTestId("set-password-screen")).toHaveCount(0);
    expect((await getAuthUser(admin!, userId)).app_metadata?.password_set_at ?? null).toBeNull();
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
