// lib/auth/email-codes — the emailed 6-digit codes.
//
// Proves: codes are 6 random digits; only an HMAC (keyed by SESSION_SECRET,
// bound to email + purpose) is stored; the compare is constant-time; codes
// expire after 10 minutes, allow 10 tries (from everyone), work once; a new
// code does NOT cancel the one already in her inbox (a stranger can't
// cancel it), but using one cancels the rest; sends are capped per email
// per purpose (burned codes don't count, so a fresh code is always allowed
// after a lock), per email overall, and site-wide for signup; and nothing
// works without the server secret.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_EMAIL_PER_HOUR_TOTAL,
  MAX_SENDS_PER_EMAIL_PER_PURPOSE_PER_HOUR,
  MAX_SENDS_PER_HOUR_SITEWIDE,
  consumeCode,
  cleanCode,
  generateCode,
  hashCode,
  hashesMatch,
  issueCode,
  maskEmail,
  verifyCode,
} from "@/lib/auth/email-codes";
import { memoryCodeStore } from "./helpers/memory-code-store";

const T0 = new Date(Date.UTC(2026, 8, 27, 15, 0, 0));
const at = (ms: number) => new Date(T0.getTime() + ms);
const EMAIL = "heather@example.com";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-for-codes");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("code basics", () => {
  it("generates 6 digits, keeping leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("cleans pasted codes and rejects anything that isn't 6 digits", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("123-456")).toBe("123456");
    expect(cleanCode("12345")).toBeNull();
    expect(cleanCode("12345a")).toBeNull();
    expect(cleanCode(123456)).toBeNull();
  });

  it("hashes with HMAC bound to purpose + email, never the plain code", () => {
    const h = hashCode({ email: EMAIL, purpose: "login", code: "123456" });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(hashCode({ email: "HEATHER@example.com ", purpose: "login", code: "123456" })).toBe(h);
    expect(hashCode({ email: EMAIL, purpose: "reset", code: "123456" })).not.toBe(h);
    expect(hashCode({ email: "other@example.com", purpose: "login", code: "123456" })).not.toBe(h);
    expect(hashCode({ email: EMAIL, purpose: "login", code: "123456" }, "different-secret")).not.toBe(h);
  });

  it("compares hashes (timingSafeEqual) and rejects wrong or empty ones", () => {
    const a = hashCode({ email: EMAIL, purpose: "login", code: "111111" });
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, hashCode({ email: EMAIL, purpose: "login", code: "222222" }))).toBe(false);
    expect(hashesMatch(a, "")).toBe(false);
    expect(hashesMatch(a, a.slice(0, 10))).toBe(false);
  });

  it("masks the email as h***@domain", () => {
    expect(maskEmail("Heather@Example.com")).toBe("h***@example.com");
    expect(maskEmail("nope")).toBe("***");
  });

  it("refuses to make or check codes without SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const store = memoryCodeStore();
    await expect(issueCode(store, { email: EMAIL, purpose: "login", now: T0 })).rejects.toThrow(
      /SESSION_SECRET/,
    );
  });
});

describe("issue + verify", () => {
  it("stores only the hash, and the right code signs in once", async () => {
    const store = memoryCodeStore();
    const issued = await issueCode(store, { email: "Heather@Example.com", purpose: "login", now: T0 });
    if (!issued.ok) throw new Error("expected a code");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].email).toBe(EMAIL);
    expect(JSON.stringify(store.rows[0])).not.toContain(issued.code);
    expect(store.rows[0].expires_at).toBe(at(CODE_TTL_MS).toISOString());

    expect(await verifyCode(store, { email: EMAIL, purpose: "login", code: issued.code, now: at(1000) })).toMatchObject({
      ok: true,
    });
    // Single use.
    expect(await verifyCode(store, { email: EMAIL, purpose: "login", code: issued.code, now: at(2000) })).toMatchObject({
      ok: false,
      reason: "no_code",
    });
  });

  it("a code for one purpose doesn't work for another", async () => {
    const store = memoryCodeStore();
    const issued = await issueCode(store, { email: EMAIL, purpose: "reset", now: T0 });
    if (!issued.ok) throw new Error("expected a code");
    const r = await verifyCode(store, { email: EMAIL, purpose: "login", code: issued.code, now: at(1000) });
    expect(r).toMatchObject({ ok: false, reason: "no_code" });
  });

  it("expires after 10 minutes", async () => {
    const store = memoryCodeStore();
    const issued = await issueCode(store, { email: EMAIL, purpose: "login", now: T0 });
    if (!issued.ok) throw new Error("expected a code");
    const r = await verifyCode(store, { email: EMAIL, purpose: "login", code: issued.code, now: at(CODE_TTL_MS) });
    expect(r).toMatchObject({ ok: false, reason: "expired" });
  });

  it("allows 10 tries, then locks the code even for the right answer", async () => {
    const store = memoryCodeStore();
    const issued = await issueCode(store, { email: EMAIL, purpose: "login", now: T0 });
    if (!issued.ok) throw new Error("expected a code");
    const wrong = issued.code === "000000" ? "111111" : "000000";
    const reasons = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await verifyCode(store, { email: EMAIL, purpose: "login", code: wrong, now: at(1000) });
      reasons.push(r.ok ? "ok" : r.reason);
    }
    expect(reasons).toEqual([...Array(MAX_ATTEMPTS - 1).fill("wrong_code"), "too_many_attempts"]);
    const r = await verifyCode(store, { email: EMAIL, purpose: "login", code: issued.code, now: at(2000) });
    expect(r).toMatchObject({ ok: false, reason: "too_many_attempts" });
    expect(store.rows[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it("parallel guesses can't get past the try limit", async () => {
    const store = memoryCodeStore();
    const issued = await issueCode(store, { email: EMAIL, purpose: "login", now: T0 });
    if (!issued.ok) throw new Error("expected a code");
    const wrong = issued.code === "000000" ? "111111" : "000000";
    await Promise.all(
      Array.from({ length: 20 }, () =>
        verifyCode(store, { email: EMAIL, purpose: "login", code: wrong, now: at(1000) }),
      ),
    );
    expect(store.rows[0].attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
  });

  it("a newer code (e.g. a stranger asking for one) doesn't cancel the one in her inbox", async () => {
    const store = memoryCodeStore();
    const hers = await issueCode(store, { email: EMAIL, purpose: "login", now: T0 });
    const strangers = await issueCode(store, { email: EMAIL, purpose: "login", now: at(60_000) });
    if (!hers.ok || !strangers.ok) throw new Error("expected codes");
    const r = await verifyCode(store, { email: EMAIL, purpose: "login", code: hers.code, now: at(61_000) });
    expect(r).toMatchObject({ ok: true, codeId: hers.codeId });
  });

  it("once one code signs her in, her other live codes stop working", async () => {
    const store = memoryCodeStore();
    const first = await issueCode(store, { email: EMAIL, purpose: "login", now: T0 });
    const second = await issueCode(store, { email: EMAIL, purpose: "login", now: at(60_000) });
    if (!first.ok || !second.ok) throw new Error("expected codes");
    expect((await verifyCode(store, { email: EMAIL, purpose: "login", code: second.code, now: at(61_000) })).ok).toBe(true);
    if (first.code !== second.code) {
      const old = await verifyCode(store, { email: EMAIL, purpose: "login", code: first.code, now: at(62_000) });
      expect(old).toMatchObject({ ok: false, reason: "no_code" });
    }
  });

  it("a wrong guess counts against every live code", async () => {
    const store = memoryCodeStore();
    const a = await issueCode(store, { email: EMAIL, purpose: "login", now: T0 });
    const b = await issueCode(store, { email: EMAIL, purpose: "login", now: at(1000) });
    if (!a.ok || !b.ok) throw new Error("expected codes");
    const wrong = ["000000", "111111", "222222"].find((c) => c !== a.code && c !== b.code)!;
    const r = await verifyCode(store, { email: EMAIL, purpose: "login", code: wrong, now: at(2000) });
    expect(r).toMatchObject({ ok: false, reason: "wrong_code", counted: true });
    expect(store.rows.map((row) => row.attempts)).toEqual([1, 1]);
  });
});

describe("send limits", () => {
  it("caps sends per email per purpose per hour, then allows more an hour later", async () => {
    const store = memoryCodeStore();
    for (let i = 0; i < MAX_SENDS_PER_EMAIL_PER_PURPOSE_PER_HOUR; i++) {
      const r = await issueCode(store, { email: EMAIL, purpose: "login", now: at(i * 1000) });
      expect(r.ok).toBe(true);
    }
    const blocked = await issueCode(store, { email: EMAIL, purpose: "login", now: at(20_000) });
    expect(blocked).toEqual({ ok: false, reason: "too_many_for_email" });
    // Another purpose has its own allowance ("Forgot password?" still works).
    expect((await issueCode(store, { email: EMAIL, purpose: "reset", now: at(20_000) })).ok).toBe(true);
    // Someone else is unaffected.
    expect((await issueCode(store, { email: "b@example.com", purpose: "login", now: at(20_000) })).ok).toBe(true);
    // An hour after the first send, a slot opens up again.
    expect((await issueCode(store, { email: EMAIL, purpose: "login", now: at(60 * 60 * 1000 + 1) })).ok).toBe(true);
  });

  it("codes locked by wrong guesses don't count: a fresh code is always allowed after a lock", async () => {
    const store = memoryCodeStore();
    for (let i = 0; i < MAX_SENDS_PER_EMAIL_PER_PURPOSE_PER_HOUR; i++) {
      await issueCode(store, { email: EMAIL, purpose: "login", now: at(i * 1000) });
    }
    expect((await issueCode(store, { email: EMAIL, purpose: "login", now: at(20_000) })).ok).toBe(false);
    // Someone burns every live code with wrong guesses.
    for (const row of store.rows) row.attempts = MAX_ATTEMPTS;
    expect((await issueCode(store, { email: EMAIL, purpose: "login", now: at(21_000) })).ok).toBe(true);
  });

  it("an overall per-email backstop counts every purpose and burned codes", async () => {
    const store = memoryCodeStore();
    for (let i = 0; i < MAX_SENDS_PER_EMAIL_PER_HOUR_TOTAL; i++) {
      const r = await issueCode(store, { email: EMAIL, purpose: i % 2 ? "reset" : "login", now: at(i) });
      expect(r.ok).toBe(true);
      for (const row of store.rows) row.attempts = MAX_ATTEMPTS;
    }
    expect(await issueCode(store, { email: EMAIL, purpose: "login", now: at(5000) })).toEqual({
      ok: false,
      reason: "too_many_for_email",
    });
  });

  it("caps signup sends site-wide per hour", async () => {
    const store = memoryCodeStore();
    for (let i = 0; i < MAX_SENDS_PER_HOUR_SITEWIDE.signup!; i++) {
      await issueCode(store, { email: `u${i}@example.com`, purpose: "signup", now: at(i) });
    }
    const r = await issueCode(store, { email: "late@example.com", purpose: "signup", now: at(5000) });
    expect(r).toEqual({ ok: false, reason: "too_many_sitewide" });
  });

  it("signup spam can't use up the login or reset codes", async () => {
    const store = memoryCodeStore();
    for (let i = 0; i < MAX_SENDS_PER_HOUR_SITEWIDE.signup!; i++) {
      await issueCode(store, { email: `spam${i}@example.com`, purpose: "signup", now: at(i) });
    }
    expect((await issueCode(store, { email: "x@example.com", purpose: "signup", now: at(100) })).ok).toBe(false);
    expect((await issueCode(store, { email: "heather@example.com", purpose: "login", now: at(200) })).ok).toBe(true);
    expect((await issueCode(store, { email: "brandon@example.com", purpose: "reset", now: at(300) })).ok).toBe(true);
  });

  it("login and reset codes have no site-wide cap — only per email", async () => {
    expect(MAX_SENDS_PER_HOUR_SITEWIDE.login).toBeNull();
    expect(MAX_SENDS_PER_HOUR_SITEWIDE.reset).toBeNull();
    const store = memoryCodeStore();
    // Far more than any old site-wide cap, spread over many accounts.
    for (let i = 0; i < 200; i++) {
      const r = await issueCode(store, { email: `l${i}@example.com`, purpose: i % 2 ? "reset" : "login", now: at(i) });
      expect(r.ok).toBe(true);
    }
    expect((await issueCode(store, { email: "heather@example.com", purpose: "login", now: at(5000) })).ok).toBe(true);
  });

  it("checking without using up: the same code works until consumed", async () => {
    const store = memoryCodeStore();
    const issued = await issueCode(store, { email: EMAIL, purpose: "signup", now: at(0) });
    if (!issued.ok) throw new Error("expected a code");
    const first = await verifyCode(store, { email: EMAIL, purpose: "signup", code: issued.code, now: at(1000), consume: false });
    expect(first.ok).toBe(true);
    const again = await verifyCode(store, { email: EMAIL, purpose: "signup", code: issued.code, now: at(2000), consume: false });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(await consumeCode(store, { codeId: again.codeId, email: EMAIL, purpose: "signup" }, at(3000))).toBe(true);
    const after = await verifyCode(store, { email: EMAIL, purpose: "signup", code: issued.code, now: at(4000) });
    expect(after).toMatchObject({ ok: false, reason: "no_code" });
  });
});
