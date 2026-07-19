// Browser Supabase client. Use in Client Components for authenticated host
// reads and realtime subscriptions. Anonymous player state goes through
// same-origin route handlers backed by the signed HTTP-only device cookie.

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

let _client: ReturnType<typeof createBrowserClient<Database>> | undefined;

// Direct static access — Turbopack/Webpack only inline NEXT_PUBLIC_* values
// when the property is referenced literally (process.env.NEXT_PUBLIC_X).
// A helper function reading process.env[name] for a dynamic `name` defeats
// that inlining and the value comes back undefined in the browser bundle.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Singleton browser client. Lazy-initialized so SSR doesn't crash on missing
 *  client-side env. Subscribe to real-time channels via this. */
export function getSupabaseBrowser() {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowser() must only be called in the browser");
  }
  if (!URL_) {
    throw new Error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL — copy .env.example to .env.local",
    );
  }
  if (!ANON) {
    throw new Error(
      "Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local",
    );
  }
  if (!_client) {
    _client = createBrowserClient<Database>(URL_, ANON);
  }
  return _client;
}
