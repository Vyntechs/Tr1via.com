// Real screens for the full-flow driver (SMOKE_BROWSER=1).
//
// Opens the real prod TV page (Chromium, 1600x900) and one real phone page
// (/room/<code>) that IS one of the driver's robot players: the robot's
// session cookies are copied into the browser, so the phone shows that
// player's own screens and the driver taps answers through the real UI.
//
// At each key moment the driver calls shot(): we wait for the TV to reach
// that moment, assert the November look is on screen (TV world pack, html
// data-theme, phone turkey/lobby markers), and save a small screenshot.
//
// Every console message goes to console.log in the output folder. Page
// crashes (pageerror) and console errors fail the run (after a short,
// explicit ignore list). No trace / HAR is recorded on purpose: those would
// put the founder's and players' cookies into a downloadable artifact.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Console errors that are not app bugs. Keep this list short and explicit;
// every ignored line is still written to the log and counted.
const IGNORED_CONSOLE = [
  // Autoplay policy: the TV chime is blocked until a human clicks the page.
  /play\(\) failed because the user didn't interact|NotAllowedError/i,
];

export class Screens {
  constructor({ base, roomCode, outDir, expectTheme, log = console.log }) {
    this.base = base;
    this.roomCode = roomCode;
    this.outDir = outDir;
    this.expectTheme = expectTheme;
    this.log = log;
    this.failures = [];
    this.consoleLines = [];
    this.consoleErrors = 0;
    this.ignoredErrors = 0;
    this.shots = [];
    this.n = 0;
    this.browser = null;
    this.tv = null;
    this.phone = null;
    this.phoneName = null;
  }

  fail(msg) {
    this.failures.push(msg);
    this.log(`  ✗ [screens] ${msg}`);
  }

  watch(page, who) {
    page.on("console", (m) => {
      const line = `[${who}] ${m.type()}: ${m.text()}`;
      this.consoleLines.push(line);
      if (m.type() === "error") {
        if (IGNORED_CONSOLE.some((re) => re.test(m.text()))) this.ignoredErrors += 1;
        else this.consoleErrors += 1;
      }
    });
    // Name the failing URL (path only, no query string) so a bare
    // "Failed to load resource" console error can be traced.
    page.on("response", (r) => {
      if (r.status() >= 400) {
        const u = new URL(r.url());
        this.consoleLines.push(`[${who}] http ${r.status()} ${r.request().method()} ${u.origin}${u.pathname}`);
      }
    });
    page.on("requestfailed", (r) => {
      const u = new URL(r.url());
      this.consoleLines.push(`[${who}] request failed ${u.origin}${u.pathname}: ${r.failure()?.errorText ?? "?"}`);
    });
    page.on("pageerror", (e) => {
      this.consoleLines.push(`[${who}] PAGEERROR: ${e?.message ?? e}`);
      this.consoleErrors += 1;
    });
  }

  async start() {
    await mkdir(this.outDir, { recursive: true });
    const { chromium } = await import("@playwright/test");
    this.browser = await chromium.launch();
    const ctx = await this.browser.newContext({
      viewport: { width: 1600, height: 900 },
      timezoneId: "America/Chicago",
    });
    this.tv = await ctx.newPage();
    this.watch(this.tv, "tv");
    await this.tv.goto(`${this.base}/tv/${this.roomCode}`, { waitUntil: "domcontentloaded" });
    this.log(`  ✓ [screens] TV open at ${this.base}/tv/${this.roomCode} (1600x900)`);
  }

  // Hand one robot's session to a real phone page.
  async attachPhone(phone) {
    const { devices } = await import("@playwright/test");
    const ctx = await this.browser.newContext({
      ...devices["Pixel 7"],
      timezoneId: "America/Chicago",
    });
    const host = new URL(this.base).hostname;
    await ctx.addCookies(
      [...phone.jar.cookies.entries()].map(([name, value]) => ({
        name,
        value,
        domain: host,
        path: "/",
        secure: this.base.startsWith("https"),
        sameSite: "Lax",
      })),
    );
    this.phone = await ctx.newPage();
    this.phoneName = phone.name;
    this.watch(this.phone, "phone");
    await this.phone.goto(`${this.base}/room/${this.roomCode}`, { waitUntil: "domcontentloaded" });
    try {
      await this.phone.waitForSelector('[data-testid="november-lobby"]', { timeout: 30000 });
      this.log(`  ✓ [screens] phone open as ${phone.name}: November lobby on screen`);
    } catch {
      this.fail(`phone (${phone.name}) did not show the November lobby (cookie handoff or theme broken)`);
    }
  }

  async themeOf(page) {
    return page.evaluate(() => document.documentElement.dataset.theme ?? null).catch(() => null);
  }

  // moments: TV moment kinds that count as "reached" (first match wins).
  // phoneSel: a November-only selector that must be on the phone, or null.
  async shot(label, { moments, phoneSel = null, timeout = 15000 }) {
    this.n += 1;
    const tag = `${String(this.n).padStart(2, "0")}-${label}`;
    const sel = moments
      .map((k) => `[data-world-pack="november"][data-world-moment="${k}"]`)
      .join(", ");
    let tvMoment = null;
    try {
      const el = await this.tv.waitForSelector(sel, { timeout });
      tvMoment = await el.getAttribute("data-world-moment");
    } catch {
      const world = await this.tv
        .$eval("[data-world-pack]", (e) => `${e.dataset.worldPack}/${e.dataset.worldMoment}`)
        .catch(() => "none");
      this.fail(`${label}: TV never reached ${moments.join("|")} in November look (saw ${world})`);
    }
    const off = await this.tv
      .$eval('[data-testid="november-world"]', (e) => e.dataset.worldOff ?? null)
      .catch(() => null);
    if (off === "true") this.fail(`${label}: TV November world is switched off`);
    const tvTheme = await this.themeOf(this.tv);
    if (tvTheme !== this.expectTheme) this.fail(`${label}: TV html data-theme="${tvTheme}", expected "${this.expectTheme}"`);

    let phoneOk = null;
    let phoneTheme = null;
    if (this.phone) {
      phoneTheme = await this.themeOf(this.phone);
      if (phoneTheme !== this.expectTheme) {
        this.fail(`${label}: phone html data-theme="${phoneTheme}", expected "${this.expectTheme}"`);
      }
      if (phoneSel) {
        phoneOk = await this.phone
          .waitForSelector(phoneSel, { timeout: 10000 })
          .then(() => true)
          .catch(() => false);
        if (!phoneOk) this.fail(`${label}: phone missing November marker ${phoneSel}`);
      }
    }
    // Let entrance animations settle a beat so the picture is readable.
    await this.tv.waitForTimeout(700);
    const tvFile = `${tag}-tv.png`;
    await this.tv.screenshot({ path: path.join(this.outDir, tvFile) }).catch((e) => this.fail(`${label}: TV screenshot ${e.message}`));
    let phoneFile = null;
    if (this.phone) {
      phoneFile = `${tag}-phone.png`;
      await this.phone.screenshot({ path: path.join(this.outDir, phoneFile) }).catch((e) => this.fail(`${label}: phone screenshot ${e.message}`));
    }
    this.shots.push({ label, tvMoment, tvTheme, phoneTheme, phoneOk, tvFile, phoneFile });
    this.log(`  ✓ [screens] ${tag}: TV=${tvMoment ?? "?"} theme=${tvTheme}/${phoneTheme ?? "-"}${phoneSel ? ` phoneMarker=${phoneOk}` : ""}`);
  }

  // Tap an answer on the real phone. Returns true if the tap landed on a
  // live answer card; the caller confirms the answer reached the server.
  async tapAnswer(slot, timeout = 15000) {
    if (!this.phone) return false;
    try {
      const btn = await this.phone.waitForSelector(`[data-testid="player-answer-${slot}"]`, { timeout });
      await btn.click({ timeout: 5000 });
      return true;
    } catch (e) {
      this.fail(`phone could not tap answer ${slot}: ${e.message.split("\n")[0]}`);
      return false;
    }
  }

  // The real "Join Game 2" button. Returns true if tapped.
  async tapJoinGame2(timeout = 20000) {
    if (!this.phone) return false;
    try {
      const btn = await this.phone.waitForSelector('[data-testid="player-join-game2-submit"]', { timeout });
      await btn.click({ timeout: 5000 });
      return true;
    } catch (e) {
      this.log(`  · [screens] Join Game 2 button not tappable (${e.message.split("\n")[0]}); driver joins by API`);
      return false;
    }
  }

  async wait(ms) {
    if (this.tv) await this.tv.waitForTimeout(ms);
  }

  // Never throws: cleanup of the night must always run after this.
  async finish() {
    try {
      await writeFile(path.join(this.outDir, "console.log"), this.consoleLines.join("\n") + "\n");
      await writeFile(
        path.join(this.outDir, "screens.json"),
        JSON.stringify(
          { expectTheme: this.expectTheme, consoleErrors: this.consoleErrors, ignoredErrors: this.ignoredErrors, failures: this.failures, shots: this.shots },
          null,
          2,
        ),
      );
    } catch (e) {
      this.log(`  · [screens] could not write logs: ${e.message}`);
    }
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    if (this.consoleErrors > 0) {
      this.failures.push(`${this.consoleErrors} console error(s) / page crash(es) on the real screens (see console.log)`);
    }
    this.log(
      `  ${this.failures.length ? "✗" : "✓"} [screens] ${this.shots.length} moments, console errors=${this.consoleErrors} (ignored=${this.ignoredErrors}), failures=${this.failures.length}`,
    );
    return this.failures;
  }
}
