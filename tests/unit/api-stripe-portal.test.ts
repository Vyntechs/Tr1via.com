// Route test — POST /api/stripe/portal.
//
// Proves: unauthenticated → 401; a host with no Stripe customer → 400 (nothing
// to manage, no Stripe call); a subscribed host gets a portal url.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ getAuthedHost: vi.fn(), createPortal: vi.fn() }));

vi.mock("@/lib/api/auth", () => ({ getAuthedHost: h.getAuthedHost }));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: h.createPortal } } }),
}));

import { POST } from "@/app/api/stripe/portal/route";

const makeReq = () =>
  new NextRequest("http://test/api/stripe/portal", {
    method: "POST",
    headers: { origin: "http://test" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.createPortal.mockResolvedValue({ url: "https://billing.test/p" });
});

describe("POST /api/stripe/portal", () => {
  it("401 when not signed in", async () => {
    h.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    expect((await POST(makeReq())).status).toBe(401);
    expect(h.createPortal).not.toHaveBeenCalled();
  });

  it("400 when the host has no stripe_customer_id", async () => {
    h.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "h1", stripe_customer_id: null } });
    expect((await POST(makeReq())).status).toBe(400);
    expect(h.createPortal).not.toHaveBeenCalled();
  });

  it("returns a portal url for a host with a customer", async () => {
    h.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "h1", stripe_customer_id: "cus_1" } });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(h.createPortal).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
    expect(await res.json()).toEqual({ url: "https://billing.test/p" });
  });
});
