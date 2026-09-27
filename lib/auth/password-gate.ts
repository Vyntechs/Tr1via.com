// Host password marker + "create your password" gate.
//
// Every account made before passwords existed has an unknown, random
// Supabase password, so "has a password" can't be read from Supabase itself.
// We keep our own marker in app_metadata (only the service-role key can
// write app_metadata, so a host can't fake it from the browser):
//
//   app_metadata.password_set_at  ISO time the host chose a password
//   app_metadata.password_prompt  "on" | "off" — founder's per-host switch
//   app_metadata.founder          true on the founder's own account, stamped
//                                 by the server when she signs in by code or
//                                 link (lib/auth/founder-flag.ts), so the
//                                 middleware gate never has to query the
//                                 hosts table on a page load. It only asks
//                                 on a device that signed in recently
//                                 (SIGNED_IN_HERE_COOKIE), so stamping it on
//                                 one sign-in never prompts her other,
//                                 already-open devices.
//
// Pure functions only: imported by middleware.ts, route handlers and tests.

import { hostReturnPath } from "@/lib/host/hostReturnPath";

export const PASSWORD_SET_AT_KEY = "password_set_at";
export const PASSWORD_PROMPT_KEY = "password_prompt";
export const FOUNDER_KEY = "founder";
export const SET_PASSWORD_PATH = "/host/set-password";
// "Not now" on the Create-your-password screen (app/auth/password-later).
// A browser-session cookie: while it's there the middleware gate lets her
// through; every sign-in clears it, so she is asked again next sign-in.
export const PASSWORD_LATER_COOKIE = "tr1via_pw_later";
export const PASSWORD_LATER_PATH = "/auth/password-later";
// "This browser just signed in" — set by every sign-in door (see
// forgetPasswordLater). The founder's prompt needs it, so it appears only on
// the device she signed in on, never on her other open devices.
export const SIGNED_IN_HERE_COOKIE = "tr1via_signed_in_here";
export const SIGNED_IN_HERE_MAX_AGE_S = 12 * 60 * 60;

export const MIN_PASSWORD_LENGTH = 8;
// Supabase (bcrypt) ignores anything past 72 bytes; cap it so a long
// password can't silently turn into a shorter one.
export const MAX_PASSWORD_LENGTH = 72;

// In-show surfaces. The live console is mirrored to the venue TV and the
// host phone is the in-hand remote — a full-screen password prompt there
// would interrupt a running night, so these are never gated.
export const IN_SHOW_PREFIXES = ["/host/live", "/host/phone"] as const;

export type PasswordPrompt = "on" | "off";

type AppMetadata = Record<string, unknown> | null | undefined;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isInShowPath(pathname: string): boolean {
  return IN_SHOW_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

export function hasPassword(appMetadata: AppMetadata): boolean {
  const v = appMetadata?.[PASSWORD_SET_AT_KEY];
  return typeof v === "string" && v.length > 0;
}

/** The raw per-host switch, or null when the founder hasn't set it. */
export function passwordPromptSetting(appMetadata: AppMetadata): PasswordPrompt | null {
  const v = appMetadata?.[PASSWORD_PROMPT_KEY];
  return v === "on" || v === "off" ? v : null;
}

/** The founder's own account (see FOUNDER_KEY). */
export function isFounderAccount(appMetadata: AppMetadata): boolean {
  return appMetadata?.[FOUNDER_KEY] === true;
}

/**
 * After a sign-in by emailed code or the founder's link: walk a host with no
 * password through "Create your password", unless the founder switched her
 * prompt explicitly "off". Used by /api/auth/verify-code and /auth/grant so
 * both doors agree.
 */
export function walkToPasswordAfterSignIn(appMetadata: AppMetadata): boolean {
  return !hasPassword(appMetadata) && passwordPromptSetting(appMetadata) !== "off";
}

function isGatedPath(pathname: string): boolean {
  if (pathname !== "/host" && !pathname.startsWith("/host/")) return false;
  if (matchesPrefix(pathname, SET_PASSWORD_PATH)) return false;
  if (isInShowPath(pathname)) return false;
  return true;
}

/**
 * Decide whether a signed-in host should be sent to "Create your password".
 * Returns the redirect target (with ?next=) or null to let them through.
 *
 * Shows only when ALL hold:
 *   - it's a /host page that isn't in-show and isn't the prompt itself
 *   - the account has no password marker yet
 *   - she hasn't tapped "Not now" since she last signed in
 *   - the founder turned the prompt "on" for this host, OR this is the
 *     founder's own account (app_metadata.founder) AND this browser signed
 *     in recently (SIGNED_IN_HERE_COOKIE). An explicit "off" always wins. Existing hosts with no setting are treated as off, so
 *     nothing changes for them until the founder flips the switch.
 * Reads app_metadata only — no database query on a page load.
 */
export function passwordGateRedirect(input: {
  pathname: string;
  search?: string;
  appMetadata: AppMetadata;
  /** She tapped "Not now" since she last signed in (PASSWORD_LATER_COOKIE). */
  askedLater?: boolean;
  /** This browser signed in recently (SIGNED_IN_HERE_COOKIE). */
  signedInHere?: boolean;
}): string | null {
  const { pathname, search = "", appMetadata, askedLater = false, signedInHere = false } = input;
  if (!isGatedPath(pathname)) return null;
  if (askedLater) return null;
  if (hasPassword(appMetadata)) return null;
  const setting = passwordPromptSetting(appMetadata);
  if (setting === "off") return null;
  if (setting !== "on" && !(isFounderAccount(appMetadata) && signedInHere)) return null;
  const next = `${pathname}${search}`;
  return `${SET_PASSWORD_PATH}?next=${encodeURIComponent(next)}`;
}

/** "Not now" link: defer the prompt, then go to `next` (default /host). */
export function passwordLaterHref(next: string = "/host"): string {
  return `${PASSWORD_LATER_PATH}?next=${encodeURIComponent(next)}`;
}

interface CookieSink {
  cookies: {
    set(cookie: {
      name: string;
      value: string;
      path: string;
      maxAge: number;
      httpOnly?: boolean;
      sameSite?: "lax";
      secure?: boolean;
    }): unknown;
  };
}

/**
 * Every sign-in calls this: a fresh sign-in asks again (clears "Not now"),
 * and marks THIS browser as just signed in (SIGNED_IN_HERE_COOKIE).
 */
export function forgetPasswordLater<T extends CookieSink>(response: T): T {
  response.cookies.set({ name: PASSWORD_LATER_COOKIE, value: "", path: "/", maxAge: 0 });
  response.cookies.set({
    name: SIGNED_IN_HERE_COOKIE,
    value: "1",
    path: "/",
    maxAge: SIGNED_IN_HERE_MAX_AGE_S,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

/**
 * Where the "Save my password" success button goes. Never back to itself,
 * and never into a show (/host/live, /host/phone): saving a password signs
 * her other devices out, so the prompt is kept away from in-show pages
 * entirely — even a hand-typed ?next= can't route through it.
 */
export function setPasswordReturnPath(next: string | null): string {
  // Same open-redirect rules as every other host return path.
  const safe = hostReturnPath(next);
  const path = safe.split("?")[0];
  if (matchesPrefix(path, SET_PASSWORD_PATH)) return "/host";
  if (isInShowPath(path)) return "/host";
  return safe;
}

export type PasswordCheck =
  | { ok: true }
  | { ok: false; field: "password" | "confirm"; error: string };

/** Plain-English checks shared by the set-password + sign-up forms and routes. */
export function checkNewPassword(password: string, confirm: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: "password",
      error: `Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: "password",
      error: `That password is too long. Please keep it under ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password !== confirm) {
    return {
      ok: false,
      field: "confirm",
      error: "The two passwords don't match. Please type the same one twice.",
    };
  }
  return { ok: true };
}
