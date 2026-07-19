// POST /api/session/init — ensure the calling browser has a valid signed
// `tr1via_device` cookie. The body is empty; the response is `{ ready: true }`.
//
// Behavior:
//   * If the cookie is present AND its HMAC verifies, keep it without rotating
//     it. Idempotent — players can call this on
//     every mount of useDeviceSession without churning their identity.
//   * Otherwise, mint a fresh UUID v4, sign it with SESSION_SECRET, and set
//     the cookie. httpOnly + SameSite=lax + Secure (in production) + 365d.
//
// We never log the deviceId or the cookie value (the id ends up in the DB
// anyway, but logs aren't the place for it).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import {
  signDeviceCookie,
  verifyDeviceCookie,
} from "@/lib/auth/device-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "tr1via_device";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name} — copy .env.example to .env.local`);
  return v;
}

export async function POST(): Promise<NextResponse> {
  const secret = env("SESSION_SECRET");
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;

  const verified = verifyDeviceCookie(existing, secret);
  if (verified) {
    return NextResponse.json({ ready: true });
  }

  const deviceId = randomUUID();
  const signed = signDeviceCookie(deviceId, secret);

  cookieStore.set(COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  return NextResponse.json({ ready: true });
}
