// PATCH /api/admin/hosts/[id] { questionEngine } — founder-only switch for a
// host's question builder ("classic" | "new").
//
//   - non-founder / signed out → 403 / 401, nothing written
//   - only "classic" and "new" are accepted
//   - writes one upsert row { host_id, engine, updated_at } on host_id
//   - if that write fails (table missing on a preview, error, throw), the
//     request does NOT 500 and does NOT undo the paywall/password changes
//     sent with it: 200 + a clear `questionEngineError` for just this field

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireFounder: vi.fn(),
  updateUserById: vi.fn(),
  hostsUpdate: vi.fn(),
  upsert: vi.fn(),
  tables: [] as string[],
  hostRow: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/api/auth", () => ({ requireFounder: h.requireFounder }));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { updateUserById: h.updateUserById } },
    from: (table: string) => {
      h.tables.push(table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.hostRow }) }) }),
        update: (patch: unknown) => {
          h.hostsUpdate(patch);
          return { eq: async () => ({ error: null }) };
        },
        upsert: (row: unknown, opts: unknown) => h.upsert(table, row, opts),
      };
    },
  }),
}));

import { PATCH } from "@/app/api/admin/hosts/[id]/route";

const req = (body: unknown) =>
  new NextRequest("http://test/api/admin/hosts/host-h", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "host-h" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.tables = [];
  h.requireFounder.mockResolvedValue({ ok: true, host: { id: "founder-host" } });
  h.updateUserById.mockResolvedValue({ data: {}, error: null });
  h.upsert.mockResolvedValue({ error: null });
  h.hostRow = {
    id: "host-h",
    user_id: "user-h",
    is_paywall_bypassed: false,
    comped_at: null,
    comped_by: null,
  };
});

describe("PATCH /api/admin/hosts/[id] · questionEngine", () => {
  it("refuses a non-founder (403) and writes nothing", async () => {
    h.requireFounder.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });
    const res = await PATCH(req({ questionEngine: "new" }), ctx);
    expect(res.status).toBe(403);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request (401) and writes nothing", async () => {
    h.requireFounder.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await PATCH(req({ questionEngine: "new" }), ctx);
    expect(res.status).toBe(401);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("rejects values other than classic / new", async () => {
    for (const bad of ["NEW", "v2", "", 1, null]) {
      const res = await PATCH(req({ questionEngine: bad }), ctx);
      expect(res.status).toBe(400);
    }
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it.each(["classic", "new"] as const)("saves %s as one upsert on host_id", async (engine) => {
    const res = await PATCH(req({ questionEngine: engine }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });
    expect(h.upsert).toHaveBeenCalledTimes(1);
    const [table, row, opts] = h.upsert.mock.calls[0];
    expect(table).toBe("host_question_engine_settings");
    expect(row).toMatchObject({ host_id: "host-h", engine });
    expect(typeof (row as { updated_at: unknown }).updated_at).toBe("string");
    expect(opts).toEqual({ onConflict: "host_id" });
    // The engine alone touches no other switch.
    expect(h.hostsUpdate).not.toHaveBeenCalled();
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("table missing: 200 with a clear error for just this field, no 500", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.upsert.mockResolvedValue({
      error: { code: "PGRST205", message: "Could not find the table" },
    });
    const res = await PATCH(req({ questionEngine: "new" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questionEngineError).toMatch(/question engine not saved/i);
    warn.mockRestore();
  });

  it("a thrown write is caught the same way", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.upsert.mockRejectedValue(new Error("fetch failed"));
    const res = await PATCH(req({ questionEngine: "classic" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).questionEngineError).toBeTruthy();
    warn.mockRestore();
  });

  it("an engine failure does not undo the paywall or password change sent with it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.upsert.mockResolvedValue({ error: { message: "relation does not exist" } });
    const res = await PATCH(
      req({ isPaywallBypassed: true, passwordPrompt: "on", questionEngine: "new" }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).questionEngineError).toBeTruthy();
    // Paywall written once, never rolled back; password switch written.
    expect(h.hostsUpdate).toHaveBeenCalledTimes(1);
    expect(h.hostsUpdate.mock.calls[0][0]).toMatchObject({ is_paywall_bypassed: true });
    expect(h.updateUserById).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("the other switches never touch the engine table", async () => {
    const res = await PATCH(req({ isPaywallBypassed: true }), ctx);
    expect(res.status).toBe(200);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.tables).not.toContain("host_question_engine_settings");
  });
});
