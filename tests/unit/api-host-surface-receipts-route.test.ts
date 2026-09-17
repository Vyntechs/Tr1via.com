import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const evidenceMock = vi.hoisted(() => ({ recordHostSurfaceEvent: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/evidence/incidentEvidence", () => evidenceMock);

const NIGHT_ID = "11111111-1111-4111-8111-111111111111";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const GAME_ID = "55555555-5555-4555-8555-555555555555";
const TAB_ID = "66666666-6666-4666-8666-666666666666";

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return builder;
}

function request(frameKind: string) {
  return new Request(`http://test/api/host/nights/${NIGHT_ID}/surface-receipts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-id": "iad1::trace" },
    body: JSON.stringify({
      questionId: QUESTION_ID,
      frameKind,
      surfaceInstanceId: TAB_ID,
      clientRelease: "dpl_abcdef123",
    }),
  });
}

describe("host surface receipts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: HOST_ID },
      night: { id: NIGHT_ID, answer_engine: "legacy" },
    });
    evidenceMock.recordHostSurfaceEvent.mockResolvedValue(true);
    const rows = {
      questions: {
        data: {
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          played_at: "2026-09-17T01:00:00.000Z",
          finished_at: null,
        },
        error: null,
      },
      categories: { data: { game_id: GAME_ID }, error: null },
      games: { data: { id: GAME_ID, night_id: NIGHT_ID }, error: null },
    } as const;
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn((table: keyof typeof rows) => query(rows[table])),
    });
  });

  it("derives timer zero from the canonical question and stores no display text", async () => {
    const { POST } = await import(
      "@/app/api/host/nights/[nightId]/surface-receipts/route"
    );
    const response = await POST(request("timer_zero"), {
      params: Promise.resolve({ nightId: NIGHT_ID }),
    });

    expect(response.status).toBe(204);
    expect(evidenceMock.recordHostSurfaceEvent).toHaveBeenCalledWith({
      nightId: NIGHT_ID,
      hostId: HOST_ID,
      answerEngine: "legacy",
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      stage: "timer_zero",
      authoritativeAt: "2026-09-17T01:00:25.000Z",
      currentWhenReceived: true,
      surfaceInstanceId: TAB_ID,
      releaseId: "dpl_abcdef123",
      traceId: "iad1::trace",
    });
  });

  it("fails privately when the evidence store is unavailable", async () => {
    evidenceMock.recordHostSurfaceEvent.mockResolvedValue(false);
    const { POST } = await import(
      "@/app/api/host/nights/[nightId]/surface-receipts/route"
    );
    const response = await POST(request("question_open"), {
      params: Promise.resolve({ nightId: NIGHT_ID }),
    });

    expect(response.status).toBe(500);
  });
});
