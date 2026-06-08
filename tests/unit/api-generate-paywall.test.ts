// Route handler test — the AI paywall gate on POST /api/categories/[id]/generate.
//
// Proves the wiring (not just the pure gate, which entitlements.test.ts covers):
//   - An ended-trial host gets 402 AND the AI pipeline is never invoked, so no
//     AI/Pexels budget is spent on a blocked host.
//   - A comped (bypassed) host passes the gate — verified by letting it fall
//     through to the existing 'already generating' idempotency 409, which can
//     only be reached AFTER the 402 gate allows the request.
//
// Module boundaries are mocked so no live Supabase / Anthropic is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedCategory: vi.fn() }));
const genMock = vi.hoisted(() => ({ generateQuestions: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
// Mock every lib/ai entry the route imports so (a) module import is side-effect
// free and (b) we can assert the pipeline is never touched for a blocked host.
vi.mock("@/lib/ai/generate-questions", () => ({
  generateQuestions: genMock.generateQuestions,
}));
vi.mock("@/lib/ai/verify-answers", () => ({ verifyAnswers: vi.fn() }));
vi.mock("@/lib/ai/auto-attach-photo", () => ({ autoAttachPhoto: vi.fn() }));
vi.mock("@/lib/ai/collect-verified-questions", () => ({
  collectVerifiedQuestions: vi.fn(),
}));

import { POST } from "@/app/api/categories/[id]/generate/route";

const CATEGORY_ID = "44444444-4444-4444-4444-444444444444";

function makeRequest(body: unknown = { difficulty: "mixed" }) {
  return new NextRequest(`http://test/api/categories/${CATEGORY_ID}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: CATEGORY_ID }) };

// Minimal owned-category result; only the fields the gate + early route read.
function owned(hostOver: Record<string, unknown>, state = "draft") {
  return {
    ok: true as const,
    host: { role: "host", is_paywall_bypassed: false, trial_ends_at: null, ...hostOver },
    night: { theme_key: "house" },
    category: { id: CATEGORY_ID, state },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/categories/[id]/generate · paywall gate", () => {
  it("blocks an ended-trial host with 402 and never calls the AI pipeline", async () => {
    authMock.requireOwnedCategory.mockResolvedValue(
      owned({ trial_ends_at: "2020-01-01T00:00:00.000Z" }),
    );

    const res = await POST(makeRequest(), ctx);

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.upgradeRequired).toBe(true);
    expect(body.error).toMatch(/upgrade/i);
    expect(genMock.generateQuestions).not.toHaveBeenCalled();
  });

  it("lets a comped (bypassed) host past the gate", async () => {
    // Bypassed host + state 'generating' → the request clears the 402 gate and
    // hits the idempotency 409. Reaching 409 proves the gate allowed it.
    authMock.requireOwnedCategory.mockResolvedValue(
      owned({ is_paywall_bypassed: true }, "generating"),
    );

    const res = await POST(makeRequest(), ctx);

    expect(res.status).toBe(409);
  });

  it("lets a paid (active subscription) host past the gate even after the trial ended", async () => {
    // Active sub + state 'generating' → clears the 402 gate, hits the 409.
    authMock.requireOwnedCategory.mockResolvedValue(
      owned(
        { subscription_status: "active", trial_ends_at: "2020-01-01T00:00:00.000Z" },
        "generating",
      ),
    );

    const res = await POST(makeRequest(), ctx);

    expect(res.status).toBe(409);
  });
});
