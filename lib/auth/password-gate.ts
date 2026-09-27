// Host password marker + "create your password" gate.
//
// Every account made before passwords existed has an unknown, random
// Supabase password, so "has a password" can't be read from Supabase itself.
// We keep our own marker in app_metadata (only the service-role key can
// write app_metadata, so a host can't fake it from the browser):
//
//   app_metadata.password_set_at  ISO time the host chose a password
//   app_metadata.password_prompt  "on" | "off" — founder's per-host switch
//
// Pure functions only: imported by middleware.ts, route handlers and tests.

export const PASSWORD_SET_AT_KEY = "password_set_at";
export const PASSWORD_PROMPT_KEY = "password_prompt";
export const SET_PASSWORD_PATH = "/host/set-password";

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

/**
 * Whether the gate still needs to know if this user is the founder.
 * Lets middleware skip the hosts-table lookup for everyone else.
 */
export function needsFounderCheck(pathname: string, appMetadata: AppMetadata): boolean {
  if (!isGatedPath(pathname)) return false;
  if (hasPassword(appMetadata)) return false;
  return passwordPromptSetting(appMetadata) === null;
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
 *   - the founder turned the prompt "on" for this host, OR this is the
 *     founder's own account. An explicit "off" always wins. Existing hosts
 *     with no setting are treated as off, so nothing changes for them until
 *     the founder flips the switch.
 */
export function passwordGateRedirect(input: {
  pathname: string;
  search?: string;
  appMetadata: AppMetadata;
  isFounder: boolean;
}): string | null {
  const { pathname, search = "", appMetadata, isFounder } = input;
  if (!isGatedPath(pathname)) return null;
  if (hasPassword(appMetadata)) return null;
  const setting = passwordPromptSetting(appMetadata);
  if (setting === "off") return null;
  if (setting !== "on" && !isFounder) return null;
  const next = `${pathname}${search}`;
  return `${SET_PASSWORD_PATH}?next=${encodeURIComponent(next)}`;
}

/**
 * Where the "Save my password" success button goes. Never back to itself,
 * and never into a show (/host/live, /host/phone): saving a password signs
 * her other devices out, so the prompt is kept away from in-show pages
 * entirely — even a hand-typed ?next= can't route through it.
 */
export function setPasswordReturnPath(next: string | null): string {
  if (!next || next.startsWith("//")) return "/host";
  const path = next.split("?")[0];
  if (matchesPrefix(path, SET_PASSWORD_PATH)) return "/host";
  if (isInShowPath(path)) return "/host";
  if (next === "/host" || next.startsWith("/host/") || next.startsWith("/host?")) {
    return next;
  }
  return "/host";
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
