// Browser Supabase client. Use in Client Components for live subscriptions
// and reads (subject to RLS).
//
// Every outgoing request carries the player's device id as the
// `x-tr1via-device` header so RLS policies that resolve via
// `current_device_id()` can identify the player. The header value is
// pulled from localStorage on each request (set there by useDeviceSession)
// — that way the singleton client picks up a freshly-minted device id
// the moment session/init completes, without us having to tear down + re-
// create the client.

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

const DEVICE_STORAGE_KEY = "tr1via_device_id";

/**
 * Custom fetch that injects the current device id header on every Supabase
 * request. Reading localStorage per-call keeps things in sync after the
 * session/init bootstrap mints a new id.
 */
function fetchWithDeviceHeader(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  try {
    const deviceId = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (deviceId) headers.set("x-tr1via-device", deviceId);
  } catch {
    // private mode / quota / storage disabled — proceed without header
  }
  return fetch(input, { ...init, headers });
}

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
    _client = createBrowserClient<Database>(URL_, ANON, {
      global: { fetch: fetchWithDeviceHeader },
    });
  }
  return _client;
}
