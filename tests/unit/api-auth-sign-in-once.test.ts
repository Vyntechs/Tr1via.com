import { beforeEach, describe, expect, it, vi } from "vitest";

// Every host button press (reveal, undo, show answer, standings, start, end)
// goes through requireOwnedGame. It used to check the sign-in again for every
// link of its chain (game -> night), and the question and category versions
// did it up to four times. Each check is a round trip to Supabase Auth plus a
// hosts lookup. The sign-in is now checked once per request; every ownership
// comparison still runs.

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {};
  const calls = { getUser: 0, hostsLookups: 0 };
  let signedInAs: string | null = null;

  function lookup(table: string, column: string, value: unknown) {
    return Promise.resolve({
      data: (tables[table] ?? []).find((row) => row[column] === value) ?? null,
      error: null,
    });
  }

  const serverClient = {
    auth: {
      getUser: vi.fn(async () => {
        calls.getUser += 1;
        return signedInAs
          ? { data: { user: { id: signedInAs } }, error: null }
          : { data: { user: null }, error: { message: "no session" } };
      }),
    },
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: () => {
            if (table === "hosts") calls.hostsLookups += 1;
            return lookup(table, column, value);
          },
        }),
      }),
    })),
  };

  const adminClient = {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: () => lookup(table, column, value),
        }),
      }),
    })),
  };

  return {
    tables,
    calls,
    serverClient,
    adminClient,
    signIn(userId: string | null) {
      signedInAs = userId;
    },
    reset() {
      for (const key of Object.keys(tables)) delete tables[key];
      calls.getUser = 0;
      calls.hostsLookups = 0;
      signedInAs = null;
      adminClient.from.mockClear();
      tables.hosts = [
        { id: "host-1", user_id: "user-1" },
        { id: "host-2", user_id: "user-2" },
      ];
      tables.nights = [
        { id: "night-1", host_id: "host-1" },
        { id: "night-2", host_id: "host-2" },
      ];
      tables.games = [
        { id: "game-1", night_id: "night-1" },
        { id: "game-2", night_id: "night-2" },
      ];
      tables.categories = [
        { id: "cat-1", game_id: "game-1" },
        { id: "cat-2", game_id: "game-2" },
      ];
      tables.questions = [
        { id: "q-1", category_id: "cat-1" },
        { id: "q-2", category_id: "cat-2" },
      ];
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServer: async () => h.serverClient }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => h.adminClient }));

import {
  requireOwnedCategory,
  requireOwnedGame,
  requireOwnedNight,
  requireOwnedQuestion,
} from "@/lib/api/auth";

describe("host ownership checks sign the user in once per request", () => {
  beforeEach(() => {
    h.reset();
    h.signIn("user-1");
  });

  it("night: one sign-in check", async () => {
    const result = await requireOwnedNight("night-1");
    expect(result).toMatchObject({ ok: true, night: { id: "night-1" }, host: { id: "host-1" } });
    expect(h.calls).toEqual({ getUser: 1, hostsLookups: 1 });
  });

  it("game (every host button press): one sign-in check, same result", async () => {
    const result = await requireOwnedGame("game-1");
    expect(result).toMatchObject({
      ok: true,
      gameId: "game-1",
      night: { id: "night-1" },
      host: { id: "host-1" },
    });
    expect(h.calls).toEqual({ getUser: 1, hostsLookups: 1 });
  });

  it("category: one sign-in check", async () => {
    const result = await requireOwnedCategory("cat-1");
    expect(result).toMatchObject({ ok: true, category: { id: "cat-1" }, night: { id: "night-1" } });
    expect(h.calls).toEqual({ getUser: 1, hostsLookups: 1 });
  });

  it("question: one sign-in check", async () => {
    const result = await requireOwnedQuestion("q-1");
    expect(result).toMatchObject({
      ok: true,
      question: { id: "q-1" },
      category: { id: "cat-1" },
      night: { id: "night-1" },
    });
    expect(h.calls).toEqual({ getUser: 1, hostsLookups: 1 });
  });
});

describe("host ownership checks still refuse everyone without access", () => {
  beforeEach(() => {
    h.reset();
  });

  const chains: Array<[string, () => Promise<{ ok: boolean; status?: number; error?: string }>, string]> = [
    ["night", () => requireOwnedNight("night-2"), "night-2"],
    ["game", () => requireOwnedGame("game-2"), "game-2"],
    ["category", () => requireOwnedCategory("cat-2"), "cat-2"],
    ["question", () => requireOwnedQuestion("q-2"), "q-2"],
  ];

  for (const [name, check] of chains) {
    it(`${name}: not signed in is 401 and nothing else is looked up`, async () => {
      h.signIn(null);
      expect(await check()).toEqual({ ok: false, status: 401, error: "not signed in" });
      expect(h.calls).toEqual({ getUser: 1, hostsLookups: 0 });
      expect(h.adminClient.from).not.toHaveBeenCalled();
    });

    it(`${name}: signed in with no host profile is 403`, async () => {
      h.signIn("user-without-host");
      expect(await check()).toEqual({ ok: false, status: 403, error: "host profile not found" });
      expect(h.adminClient.from).not.toHaveBeenCalled();
    });

    it(`${name}: another host's ${name} is refused with 403`, async () => {
      h.signIn("user-1");
      expect(await check()).toEqual({ ok: false, status: 403, error: "not your night" });
      expect(h.calls.getUser).toBe(1);
    });

    it(`${name}: the owner of that ${name} is let in`, async () => {
      h.signIn("user-2");
      expect(await check()).toMatchObject({ ok: true });
      expect(h.calls.getUser).toBe(1);
    });
  }

  it("missing rows are still 404 at each link", async () => {
    h.signIn("user-1");
    expect(await requireOwnedNight("nope")).toEqual({ ok: false, status: 404, error: "night not found" });
    expect(await requireOwnedGame("nope")).toEqual({ ok: false, status: 404, error: "game not found" });
    expect(await requireOwnedCategory("nope")).toEqual({ ok: false, status: 404, error: "category not found" });
    expect(await requireOwnedQuestion("nope")).toEqual({ ok: false, status: 404, error: "question not found" });

    h.tables.games.push({ id: "game-orphan", night_id: "night-missing" });
    expect(await requireOwnedGame("game-orphan")).toEqual({ ok: false, status: 404, error: "night not found" });
  });
});
