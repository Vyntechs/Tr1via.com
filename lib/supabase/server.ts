// Server Supabase client for Server Components, Route Handlers, and Server
// Actions. RLS-on: queries run under the caller's auth user. For player
// requests it forwards the device_id cookie as the x-tr1via-device header
// so current_device_id() in Postgres can identify the player.
//
// The cookie value on the wire is `${deviceId}.${hmac}` (see
// lib/auth/device-cookie.ts). We verify + extract the raw UUID here before
// sending it as the header, so Postgres sees just the UUID.

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyDeviceCookie } from "@/lib/auth/device-cookie";
import type { Database } from "./types";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

const DEVICE_COOKIE = "tr1via_device";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name} — copy .env.example to .env.local`);
  return v;
}

/**
 * Server-side Supabase client bound to the current request's auth + device
 * cookie. RLS on. Use in Server Components, Route Handlers, Server Actions.
 *
 * The return type is explicitly `SupabaseClient<Database>` because the
 * `@supabase/ssr@0.5` `createServerClient` generic doesn't forward `Database`
 * cleanly to the underlying client (its types import a path that newer
 * `@supabase/supabase-js` no longer ships, so the schema collapses to `any`).
 * Asserting here gives every call site fully typed `.from(...)` queries.
 */
export async function getSupabaseServer(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const rawCookie = cookieStore.get(DEVICE_COOKIE)?.value;
  // SESSION_SECRET only available server-side; missing in some tests, so
  // fall back to "" — verify will return null and we send an empty header.
  const secret = process.env.SESSION_SECRET ?? "";
  const deviceId = secret ? (verifyDeviceCookie(rawCookie, secret) ?? "") : "";

  const client = createServerClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items: CookieToSet[]) {
          // In Server Components this throws (cookies are read-only). In
          // Route Handlers / Server Actions it works. Swallow the SC case.
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* read-only context */
          }
        },
      },
      global: {
        headers: {
          "x-tr1via-device": deviceId,
        },
      },
    },
  );
  return client as unknown as SupabaseClient<Database>;
}
