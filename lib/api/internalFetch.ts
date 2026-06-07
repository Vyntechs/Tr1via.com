// Build an internal fetch bound to a cookie jar seeded from the inbound
// request, so a server route can drive OTHER authenticated routes AS the same
// signed-in user. The Supabase SSR client refreshes auth tokens mid-request and
// writes new cookies on each response; we capture + forward them so the next
// internal call doesn't send a stale token and 401. Proven pattern, lifted from
// /api/_test/seed-night.

import type { NextRequest } from "next/server";

export function makeInternalFetch(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const jar = new Map<string, string>();

  function ingest(raw: string | null, isSetCookie: boolean) {
    if (!raw) return;
    // Set-Cookie: split on commas that precede a `name=` (not commas inside
    // Expires=Mon, 23-...). Request cookie header: split on `; `.
    const parts = isSetCookie ? raw.split(/,(?=[^ ;]+=)/) : raw.split(/;\s*/);
    for (const part of parts) {
      const pair = isSetCookie ? part.split(";")[0] : part;
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) jar.set(name, value);
    }
  }

  ingest(req.headers.get("cookie"), false);

  return async function internalFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(init.headers ?? {}),
      },
    });
    ingest(res.headers.get("set-cookie"), true);
    return res;
  };
}
