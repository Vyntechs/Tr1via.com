// POST {questionId} → invokes the existing /api/questions/[id]/resolve.
// The resolve route is already idempotent + race-safe (the resolve_question
// RPC does a SELECT … FOR UPDATE on questions), so calling it directly
// from a test is equivalent to the client-driven T+20 path — no "force"
// parameter is needed.

import { NextResponse, type NextRequest } from "next/server";
import { isTestModeEnabled } from "@/lib/api/require-test-mode";

export async function POST(req: NextRequest) {
  if (!isTestModeEnabled(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { questionId?: string } | null;
  if (!body?.questionId) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/questions/${body.questionId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-secret": req.headers.get("x-test-secret") ?? "",
    },
    body: JSON.stringify({ force: true }),
  });
  const json = await res.json().catch(() => null);
  return NextResponse.json({ resolved: res.ok, body: json }, { status: res.status });
}
