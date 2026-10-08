// The sign-in / ownership time marks the diagnostic log reads must keep firing
// through every ownership helper, however lib/api/auth.ts is arranged inside
// (this test passes before and after PR #211 rearranges those helpers).

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {
    hosts: [{ id: "host-1", user_id: "user-1" }],
    nights: [{ id: "night-1", host_id: "host-1" }],
    games: [{ id: "game-1", night_id: "night-1" }],
    categories: [{ id: "cat-1", game_id: "game-1" }],
    questions: [{ id: "q-1", category_id: "cat-1" }],
  };
  const find = (table: string, column: string, value: unknown) =>
    Promise.resolve({ data: (tables[table] ?? []).find((row) => row[column] === value) ?? null, error: null });
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })) },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({ maybeSingle: () => find(table, column, value) }),
      }),
    }),
  };
  return { client };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServer: async () => h.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => h.client }));

import { getAuthedHost, requireOwnedGame, requireOwnedNight, requireOwnedQuestion } from "@/lib/api/auth";
import { runInTrace, startTrace } from "@/lib/diagnostics/trace";

async function tracedFor(run: () => Promise<{ ok: boolean }>) {
  const trace = startTrace();
  const result = await runInTrace(trace, run);
  return { trace, result };
}

async function marksFor(run: () => Promise<{ ok: boolean }>) {
  const { trace, result } = await tracedFor(run);
  expect(result.ok).toBe(true);
  return trace.marks;
}

describe("diagnostic time marks in the host ownership checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["night", () => requireOwnedNight("night-1")],
    ["game", () => requireOwnedGame("game-1")],
    ["question", () => requireOwnedQuestion("q-1")],
  ])("records the sign-in and ownership marks for a %s", async (_name, run) => {
    const marks = await marksFor(run);
    expect(marks).toHaveProperty("auth_done");
    expect(marks).toHaveProperty("auth_done_last");
    expect(marks).toHaveProperty("owned_done");
  });

  // The log stores a host press only for a host the sign-in check really
  // identified (and who owns the night, which the log then checks itself).
  it.each([
    ["night", () => requireOwnedNight("night-1")],
    ["game", () => requireOwnedGame("game-1")],
    ["question", () => requireOwnedQuestion("q-1")],
    ["bare sign-in", () => getAuthedHost()],
  ])("notes which host signed in, for a %s check", async (_name, run) => {
    const { trace, result } = await tracedFor(run);
    expect(result.ok).toBe(true);
    expect(trace.notes.hostId).toBe("host-1");
  });

  it("notes no host when the sign-in check fails", async () => {
    h.client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "no session" } } as never);
    const { trace, result } = await tracedFor(() => getAuthedHost());
    expect(result.ok).toBe(false);
    expect(trace.notes).not.toHaveProperty("hostId");
  });

  it("changes nothing for a caller outside a logged request", async () => {
    await expect(requireOwnedNight("night-1")).resolves.toMatchObject({ ok: true });
  });
});
