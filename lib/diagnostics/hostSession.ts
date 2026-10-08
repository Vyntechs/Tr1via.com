// Who is the signed-in host behind a diagnostic report? STRICTLY READ-ONLY.
//
// The host laptop's report is checked AFTER the reply has gone out. The normal
// check (getAuthedHost -> supabase.auth.getUser()) is not safe to run from
// there: when the browser's access token is close to expiry it silently RENEWS
// the session, which uses up the refresh token, and the new tokens can only be
// written to cookies on a response that has already left. The browser would
// keep its old refresh token, and its own next renewal could then be refused,
// signing the host out in the middle of a show.
//
// So this module never renews and never touches a cookie:
//   1. it reads the access token out of the sign-in cookie exactly as it is;
//   2. an access token that is already expired (or about to be) is dropped on
//      the spot, with no network call at all: the report is simply not stored;
//   3. otherwise it asks the sign-in service "who is this?" with that token
//      (GET /user), using a throwaway client that cannot refresh, has no
//      storage and no cookies;
//   4. it looks the host up by user id with the service-role client.
//
// It does not import next/headers, @supabase/ssr or getSupabaseServer, and
// tests/unit/diagnostics-host-session.test.ts fails if anyone adds them.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isSupabaseSessionCookie } from "@/lib/auth/session-cookies";
import { DIAG_ABORT_HOLD_MS, DIAG_CALL_CEILING_MS, DIAG_WRITE_TIMEOUT_MS } from "./config";
import { DiagLookupSlow, trackedCall, withDeadline } from "./deadline";

const BASE64_PREFIX = "base64-";
/** An access token with less than this left is treated as expired (no network call). */
const EXPIRY_MARGIN_MS = 10_000;

export interface SessionCookie {
  name: string;
  value: string;
}

/** Only the sign-in cookies of a request (all chunks), nothing else. */
export function sessionCookiesOf(all: SessionCookie[]): SessionCookie[] {
  return all.filter((c) => isSupabaseSessionCookie(c.name));
}

function decodeSession(raw: string): { access_token?: unknown; expires_at?: unknown } | null {
  try {
    let text = raw;
    if (text.startsWith(BASE64_PREFIX)) {
      text = Buffer.from(text.slice(BASE64_PREFIX.length), "base64url").toString("utf8");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = JSON.parse(decodeURIComponent(text));
    }
    return parsed && typeof parsed === "object" ? (parsed as { access_token?: unknown; expires_at?: unknown }) : null;
  } catch {
    return null;
  }
}

/**
 * The access token in the sign-in cookies, exactly as the browser holds it, or
 * null when there is none, it cannot be read, or it is already (nearly)
 * expired. Pure: no network, no cookie writes.
 */
export function accessTokenFromCookies(cookies: SessionCookie[], now: number = Date.now()): string | null {
  const bases = new Map<string, { whole?: string; chunks: Map<number, string> }>();
  for (const { name, value } of cookies) {
    const match = /^(sb-[^-]+-auth-token)(?:\.(\d+))?$/.exec(name);
    if (!match) continue;
    const entry = bases.get(match[1]!) ?? { chunks: new Map<number, string>() };
    if (match[2] === undefined) entry.whole = value;
    else entry.chunks.set(Number(match[2]), value);
    bases.set(match[1]!, entry);
  }
  for (const entry of bases.values()) {
    let raw = entry.whole;
    if (raw === undefined && entry.chunks.size > 0) {
      const parts: string[] = [];
      for (let i = 0; entry.chunks.has(i); i += 1) parts.push(entry.chunks.get(i)!);
      raw = parts.join("");
    }
    if (!raw) continue;
    const session = decodeSession(raw);
    if (!session || typeof session.access_token !== "string" || session.access_token.length === 0) continue;
    if (typeof session.expires_at === "number" && session.expires_at * 1000 - now < EXPIRY_MARGIN_MS) return null;
    return session.access_token;
  }
  return null;
}

// A client that can only ask "who is this token?". Nothing is stored, nothing
// is refreshed, there are no cookies to write.
let readOnlyClient: SupabaseClient | null = null;
function authClient(): SupabaseClient {
  if (!readOnlyClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Missing Supabase env");
    readOnlyClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return readOnlyClient;
}

/** Test hook. */
export function __resetHostSessionForTests(): void {
  readOnlyClient = null;
}

/**
 * The host id behind these sign-in cookies, or null (no cookie, expired, not
 * signed in, not a host). Throws DiagLookupSlow when the sign-in service or the
 * database could not answer in time (the caller counts that as "slow", not as
 * a stranger). Never renews a session, never writes a cookie.
 */
export async function verifyHostSessionReadOnly(cookies: SessionCookie[]): Promise<string | null> {
  const accessToken = accessTokenFromCookies(cookies);
  if (!accessToken) return null;
  try {
    const { data, error } = await withDeadline(DIAG_WRITE_TIMEOUT_MS, () => authClient().auth.getUser(accessToken));
    // A token the service does not accept (expired, signed out, forged) is a plain "no".
    if (error || !data?.user) {
      // The service itself failing (a server error, or no answer at all) is "could not check", not "no".
      const failure = error as { status?: number; name?: string } | null;
      if (
        failure?.name === "AuthRetryableFetchError" ||
        (typeof failure?.status === "number" && (failure.status === 0 || failure.status >= 500))
      ) {
        throw new DiagLookupSlow();
      }
      return null;
    }
    const userId = data.user.id;
    // A read of the database: the job that makes it keeps its turn until the read
    // has returned, even if we stop waiting after DIAG_WRITE_TIMEOUT_MS (deadline.ts).
    const host = await trackedCall(
      async (signal) => {
        const query = getSupabaseAdmin().from("hosts").select("id").eq("user_id", userId);
        const result = await (typeof (query as { abortSignal?: unknown }).abortSignal === "function"
          ? (query as unknown as { abortSignal(s: AbortSignal): typeof query }).abortSignal(signal)
          : query
        ).maybeSingle();
        if (result.error) throw result.error;
        return result.data as { id?: unknown } | null;
      },
      { ceilingMs: DIAG_CALL_CEILING_MS, holdAfterAbortMs: DIAG_ABORT_HOLD_MS, giveUpAfterMs: DIAG_WRITE_TIMEOUT_MS },
    );
    return host && typeof host.id === "string" ? host.id : null;
  } catch (error) {
    if (error instanceof DiagLookupSlow) throw error;
    throw new DiagLookupSlow();
  }
}
