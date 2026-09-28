// Route-handler Supabase client whose auth cookies are held until we know
// which response we're sending. Sign-in routes decide success vs. a friendly
// error AFTER talking to Supabase; only a success response should carry the
// session cookies.

import type { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

// Supabase SSR session cookies: sb-<project>-auth-token, maybe chunked (.0, .1…).
const SESSION_COOKIE_NAME = /^sb-[^-]+-auth-token(?:\.\d+)?$/;

/** True for a Supabase SSR session cookie name (any chunk). */
export function isSupabaseSessionCookie(name: string): boolean {
  return SESSION_COOKIE_NAME.test(name);
}

export function createSessionCookieClient(req: NextRequest) {
  const pending: CookieToSet[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (toSet: CookieToSet[]) => {
          pending.push(...toSet);
        },
      },
    },
  );
  function applyCookies<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of pending) {
      response.cookies.set({ name, value, ...options });
    }
    return response;
  }
  return { supabase, applyCookies };
}
