// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: auth.createServerClient,
}));

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Wednesday legacy venue traffic safety contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    auth.getUser.mockResolvedValue({ data: { user: null } });
    auth.createServerClient.mockReturnValue({
      auth: { getUser: auth.getUser },
    });
  });

  test("40 legacy players do not turn ordinary live API traffic into remote auth traffic", async () => {
    const { middleware } = await import("../../middleware");

    const answerSubmissions = Array.from(
      { length: 40 },
      () => new NextRequest("https://tr1via.com/api/answers", { method: "POST" }),
    );
    const signedSnapshots = Array.from(
      { length: 40 },
      () => new NextRequest("https://tr1via.com/api/room/Z8RJDJ/snapshot"),
    );
    const hostAndTv = [
      new NextRequest("https://tr1via.com/api/tv/Z8RJDJ/snapshot"),
      new NextRequest("https://tr1via.com/api/games/game-1/locks"),
    ];

    await Promise.all(
      [...answerSubmissions, ...signedSnapshots, ...hostAndTv].map(middleware),
    );

    // Before #160, all 82 requests called Supabase Auth before their route
    // handler. At venue scale that remote dependency could stall every live
    // surface at once. API handlers own auth; root middleware must do none.
    expect(auth.createServerClient).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  test("legacy answers cannot produce the resilient N-squared answer-progress fanout", () => {
    const answersRoute = source("app/api/answers/route.ts");
    const legacyBranch = answersRoute.slice(
      answersRoute.indexOf("const parsed = legacy"),
    );

    expect(legacyBranch).toContain('night.answer_engine !== "legacy"');
    expect(legacyBranch).toContain('from("answers")');
    expect(legacyBranch).not.toContain("broadcastAppliedLiveRoomEvent");
    expect(legacyBranch).not.toContain("answer_progress");
  });

});
