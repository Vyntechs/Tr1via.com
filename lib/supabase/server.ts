// Server Supabase client for Server Components, Route Handlers, and Server
// Actions. RLS-on: queries run under the caller's auth user. For player
// requests it forwards the device_id cookie as the x-tr1via-device header
// so current_device_id() in Postgres can identify the player.

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
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
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();
  const deviceId = cookieStore.get(DEVICE_COOKIE)?.value ?? "";

  return createServerClient<Database>(
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
}
