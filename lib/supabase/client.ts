// Browser Supabase client. Use in Client Components for live subscriptions
// and reads (subject to RLS).

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

let _client: ReturnType<typeof createBrowserClient<Database>> | undefined;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name} — copy .env.example to .env.local`);
  return v;
}

/** Singleton browser client. Lazy-initialized so SSR doesn't crash on missing
 *  client-side env. Subscribe to real-time channels via this. */
export function getSupabaseBrowser() {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowser() must only be called in the browser");
  }
  if (!_client) {
    _client = createBrowserClient<Database>(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
  }
  return _client;
}
