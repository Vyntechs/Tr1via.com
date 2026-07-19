import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);

function makeRequest(body: unknown) {
  return new NextRequest("http://test/api/topic-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeAdmin(
  existing: null | { id: string; text: string; created_at: string },
  writeError: { message: string } | null = null,
) {
  const calls = {
    insert: null as null | Record<string, unknown>,
    update: null as null | Record<string, unknown>,
  };
  const player = { id: "player-1", night_id: "night-1" };
  const inserted = { id: "suggestion-1", text: "Pixar movies", created_at: "2026-07-05T01:00:00Z" };
  const updated = {
    id: existing?.id ?? "suggestion-1",
    text: "Pixar movies",
    created_at: existing?.created_at ?? inserted.created_at,
  };

  const client = {
    from: vi.fn((table: string) => {
      if (table === "players") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: player, error: null }),
        };
      }
      if (table === "topic_suggestions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          insert: vi.fn((row: Record<string, unknown>) => {
            calls.insert = row;
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: writeError ? null : inserted,
                  error: writeError,
                }),
              })),
            };
          }),
          update: vi.fn((row: Record<string, unknown>) => {
            calls.update = row;
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: writeError ? null : updated,
                    error: writeError,
                  }),
                })),
              })),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client, calls };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  authMock.getDeviceId.mockResolvedValue("device-1");
});

describe("POST /api/topic-suggestions", () => {
  it("401s without a device session", async () => {
    authMock.getDeviceId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/topic-suggestions/route");
    const res = await POST(makeRequest({ text: "Pixar" }));
    expect(res.status).toBe(401);
  });

  it("400s on empty text", async () => {
    const { POST } = await import("@/app/api/topic-suggestions/route");
    const res = await POST(makeRequest({ text: "   " }));
    expect(res.status).toBe(400);
  });

  it("inserts the first suggestion for a player", async () => {
    const { client, calls } = makeAdmin(null);
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { POST } = await import("@/app/api/topic-suggestions/route");
    const res = await POST(makeRequest({ text: "  Pixar movies  " }));
    expect(res.status).toBe(201);
    expect(calls.insert).toEqual({ player_id: "player-1", text: "Pixar movies" });
    expect(await res.json()).toMatchObject({ suggestionId: "suggestion-1", text: "Pixar movies", updated: false });
  });

  it("updates the player's existing visible suggestion", async () => {
    const { client, calls } = makeAdmin({
      id: "suggestion-old",
      text: "Old idea",
      created_at: "2026-07-05T00:00:00Z",
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { POST } = await import("@/app/api/topic-suggestions/route");
    const res = await POST(makeRequest({ text: "Pixar movies" }));
    expect(res.status).toBe(200);
    expect(calls.insert).toBeNull();
    expect(calls.update).toEqual({ text: "Pixar movies" });
    expect(await res.json()).toMatchObject({ suggestionId: "suggestion-old", updated: true });
  });

  it("never exposes a topic suggestion database error", async () => {
    const sentinel = "SENTINEL topic_suggestions private constraint";
    const { client } = makeAdmin(null, { message: sentinel });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import("@/app/api/topic-suggestions/route");
    const res = await POST(makeRequest({ text: "Pixar movies" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain(sentinel);
  });
});
