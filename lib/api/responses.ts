// Standard JSON response helpers for TR1VIA route handlers.
//
// Every API route returns the same shape on error so the client can
// uniformly surface "something went wrong." Centralising the helpers also
// keeps status codes consistent — there's exactly one place where 400/401/
// 403/404/409/500 happen.

import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function ok<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(error: string | ZodError): NextResponse {
  if (typeof error === "string") {
    return NextResponse.json({ error }, { status: 400 });
  }
  // Zod errors → flatten the first issue for a clean human message.
  const flat = error.flatten();
  const firstFieldErrors = Object.values(flat.fieldErrors).find(
    (msgs): msgs is string[] => Array.isArray(msgs) && msgs.length > 0,
  );
  const message =
    flat.formErrors[0] ??
    firstFieldErrors?.[0] ??
    "invalid request body";
  return NextResponse.json(
    { error: message, issues: flat },
    { status: 400 },
  );
}

export function unauthorized(reason = "not signed in"): NextResponse {
  return NextResponse.json({ error: reason }, { status: 401 });
}

export function forbidden(reason = "forbidden"): NextResponse {
  return NextResponse.json({ error: reason }, { status: 403 });
}

export function notFound(what = "not found"): NextResponse {
  return NextResponse.json({ error: what }, { status: 404 });
}

export function conflict(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 409 });
}

export function serverError(reason = "server error"): NextResponse {
  return NextResponse.json({ error: reason }, { status: 500 });
}
