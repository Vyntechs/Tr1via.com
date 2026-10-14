import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedGame: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const EXISTING_ID = "22222222-2222-2222-2222-222222222222";
const NEW_ID = "33333333-3333-3333-3333-333333333333";

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://test/api/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { gameId: GAME_ID, name: "Marvel MCU", topic: "Marvel MCU", position: 1 };

// A dropped-then-retried "Pull questions" must not create a second category at
// the same slot. The create route is get-or-create on the slot (game_id, position).
type Row = {
  id: string;
  game_id?: string;
  name: string;
  topic: string;
  position: number;
  state: string;
  created_at?: string;
};

const EXISTING_ROW: Row = {
  id: EXISTING_ID,
  game_id: GAME_ID,
  name: "Marvel MCU",
  topic: "Marvel MCU",
  position: 1,
  state: "draft",
  created_at: "2026-10-03T15:36:41.777Z",
};

function createAdmin({
  existing,
  selectError = false,
  rows,
  insertError,
  rowsAfterInsertError,
  picked = [],
}: {
  existing: boolean;
  selectError?: boolean;
  /** Rows already in the slot (overrides `existing`). */
  rows?: Row[];
  /** Make the insert fail with this Postgres error. */
  insertError?: { code?: string; message: string };
  /** What the slot holds when the route looks again after a failed insert. */
  rowsAfterInsertError?: Row[];
  /** Picked questions the route sees if it counts them for a doubled slot. */
  picked?: Array<{ category_id: string }>;
}) {
  const pickedLookups: unknown[][] = [];
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () =>
        insertError
          ? { data: null, error: insertError }
          : {
              data: { id: NEW_ID, name: "Marvel MCU", topic: "Marvel MCU", position: 1, state: "draft" },
              error: null,
            },
      ),
    })),
  }));

  const firstRows = rows ?? (existing ? [EXISTING_ROW] : []);
  const lookupEqCalls: Array<[string, unknown]> = [];
  let lookups = 0;

  const admin = {
    from: vi.fn((table: string) => {
      if (table === "questions") {
        const q: Record<string, unknown> = {};
        for (const method of ["select", "in", "eq"]) {
          q[method] = vi.fn((...args: unknown[]) => {
            pickedLookups.push([method, ...args]);
            return q;
          });
        }
        q.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: picked, error: null }).then(resolve, reject);
        return q;
      }
      if (table !== "categories") throw new Error(`unexpected table: ${table}`);
      const lookup: Record<string, unknown> = {};
      for (const method of ["select", "limit", "order"]) lookup[method] = vi.fn(() => lookup);
      lookup.eq = vi.fn((column: string, value: unknown) => {
        lookupEqCalls.push([column, value]);
        return lookup;
      });
      lookup.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        lookups += 1;
        const data = lookups === 1 ? firstRows : (rowsAfterInsertError ?? firstRows);
        const result = selectError
          ? { data: null, error: { message: "db read failed" } }
          : { data, error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return { ...lookup, insert };
    }),
  };
  return { admin, insert, lookupEqCalls, lookupCount: () => lookups, pickedLookups };
}

describe("POST /api/categories — idempotent get-or-create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night: { id: "night" },
    });
  });

  it("returns the existing category on a retried create instead of duplicating the slot", async () => {
    const { admin, insert } = createAdmin({ existing: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { category: { id: string } };
    expect(body.category.id).toBe(EXISTING_ID);
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails closed (does not insert) when the idempotency lookup itself errors", async () => {
    // A transient DB/read failure on the get-or-create SELECT must NOT fall
    // through to a plain insert — that would duplicate the slot on a retry,
    // the exact thing the idempotency guard exists to prevent.
    const { admin, insert } = createAdmin({ existing: false, selectError: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a new category when the slot is empty", async () => {
    const { admin, insert } = createAdmin({ existing: false });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { category: { id: string } };
    expect(body.category.id).toBe(NEW_ID);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("keys the slot lookup on game + position only, never on the topic text", async () => {
    const { admin, lookupEqCalls } = createAdmin({ existing: false });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    await POST(createRequest(validBody));

    const columns = lookupEqCalls.map(([column]) => column);
    expect(columns).toContain("game_id");
    expect(columns).toContain("position");
    expect(columns).not.toContain("topic");
  });

  it("does not add a second category when the same topic comes back with different capitals (2026-10-03 ghost stories case)", async () => {
    // Slot already holds "Legendary Ghost stories"; the host typed it again as
    // "legendary ghost stories". Before the fix this inserted a second row.
    const { admin, insert } = createAdmin({
      existing: true,
      rows: [{ ...EXISTING_ROW, name: "Legendary Ghost stories", topic: "Legendary Ghost stories", state: "generating" }],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(
      createRequest({
        gameId: GAME_ID,
        name: "legendary ghost stories",
        topic: "legendary  ghost stories ",
        position: 1,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      category: { id: string };
      reused: boolean;
      sameTopic: boolean;
    };
    expect(body.category.id).toBe(EXISTING_ID);
    expect(body.reused).toBe(true);
    expect(body.sameTopic).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not add a second category when a different topic is aimed at a filled slot", async () => {
    // 2026-10-13: "Saint or Sitcom Character?" then "Is That Actually Catholic?"
    // three minutes later in the same slot made two rows.
    const { admin, insert } = createAdmin({
      existing: true,
      rows: [
        {
          ...EXISTING_ROW,
          name: "Saint or Sitcom Character?",
          topic: "Saint or Sitcom Character?",
          state: "review",
        },
      ],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(
      createRequest({
        gameId: GAME_ID,
        name: "Is That Actually Catholic?",
        topic: "Is That Actually Catholic?",
        position: 1,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      category: { id: string; name: string };
      reused: boolean;
      sameTopic: boolean;
    };
    expect(body.category.id).toBe(EXISTING_ID);
    expect(body.category.name).toBe("Saint or Sitcom Character?");
    expect(body.reused).toBe(true);
    expect(body.sameTopic).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("answers with the row every screen shows when the slot is already doubled", async () => {
    const orphan: Row = {
      ...EXISTING_ROW,
      id: "44444444-4444-4444-4444-444444444444",
      name: "Legendary Ghost stories",
      topic: "Legendary Ghost stories",
      state: "review",
      created_at: "2026-10-03T15:36:41.777Z",
    };
    const real: Row = {
      ...EXISTING_ROW,
      name: "Ghost Stories",
      topic: "legendary ghost stories",
      state: "ready",
      created_at: "2026-10-03T15:37:09.161Z",
    };
    const { admin, insert } = createAdmin({ existing: true, rows: [orphan, real] });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(
      createRequest({ gameId: GAME_ID, name: "Ghost stories", topic: "Ghost stories", position: 1 }),
    );

    const body = (await response.json()) as { category: { id: string } };
    expect(body.category.id).toBe(EXISTING_ID);
    expect(insert).not.toHaveBeenCalled();
  });

  it("in a doubled slot, answers with the older row that has her picked questions, not a newer empty one", async () => {
    const filled: Row = { ...EXISTING_ROW, id: "44444444-4444-4444-4444-444444444444", state: "review", created_at: "2026-10-14T18:00:00Z" };
    const empty: Row = { ...EXISTING_ROW, id: "55555555-5555-5555-5555-555555555555", state: "review", created_at: "2026-10-14T18:01:00Z" };
    const picked = Array.from({ length: 7 }, () => ({ category_id: filled.id }));
    const { admin, insert, pickedLookups } = createAdmin({ existing: true, rows: [filled, empty], picked });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { category: { id: string } };
    expect(body.category.id).toBe(filled.id);
    expect(insert).not.toHaveBeenCalled();
    // Only the doubled slot's rows are counted, picked questions only.
    expect(pickedLookups).toContainEqual(["in", "category_id", [filled.id, empty.id]]);
    expect(pickedLookups).toContainEqual(["eq", "is_picked", true]);
  });

  it("makes no picked-question lookup for a normal filled slot", async () => {
    const { admin, pickedLookups } = createAdmin({ existing: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/categories/route");
    await POST(createRequest(validBody));
    expect(pickedLookups).toEqual([]);
  });

  it("answers with the winning row when two creates race and the one-per-slot rule rejects the second", async () => {
    const { admin, insert, lookupCount } = createAdmin({
      existing: false,
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
      rowsAfterInsertError: [EXISTING_ROW],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { category: { id: string }; reused: boolean };
    expect(body.category.id).toBe(EXISTING_ID);
    expect(body.reused).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(lookupCount()).toBe(2);
  });

  it("still reports other insert failures as errors", async () => {
    const { admin } = createAdmin({
      existing: false,
      insertError: { code: "23503", message: "game is gone" },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(500);
  });
});
