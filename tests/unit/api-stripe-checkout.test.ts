// Route test — POST /api/stripe/checkout.
//
// Proves: unauthenticated → 401 (no Stripe call); a host without a customer
// gets one created + stored, then a subscription Checkout Session; an existing
// customer is reused; and we NEVER pass payment_method_types (dynamic methods).
// All module boundaries mocked — no live Stripe/Supabase.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getAuthedHost: vi.fn(),
  createCustomer: vi.fn(),
  createSession: vi.fn(),
  getUserById: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ getAuthedHost: h.getAuthedHost }));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    customers: { create: h.createCustomer },
    checkout: { sessions: { create: h.createSession } },
  }),
  monthlyPriceId: () => "price_month_test",
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: h.getUserById } },
    from: () => ({ update: h.update }),
  }),
}));

import { POST } from "@/app/api/stripe/checkout/route";

function makeReq() {
  return new NextRequest("http://test/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://test" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.update.mockReturnValue({ eq: h.eq });
  h.eq.mockResolvedValue({ error: null });
  h.createCustomer.mockResolvedValue({ id: "cus_new" });
  h.createSession.mockResolvedValue({ url: "https://checkout.test/s" });
  h.getUserById.mockResolvedValue({ data: { user: { email: "h@example.com" } } });
});

describe("POST /api/stripe/checkout", () => {
  it("401 when not signed in, and starts no checkout", async () => {
    h.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "not signed in" });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it("creates + stores a customer, then opens a subscription session", async () => {
    h.getAuthedHost.mockResolvedValue({
      ok: true,
      host: { id: "h1", user_id: "u1", stripe_customer_id: null },
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(h.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: "h@example.com", metadata: { host_id: "h1" } }),
    );
    expect(h.eq).toHaveBeenCalledWith("id", "h1"); // stored the new customer id
    expect(h.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_new",
        line_items: [{ price: "price_month_test", quantity: 1 }],
      }),
    );
    expect(await res.json()).toEqual({ url: "https://checkout.test/s" });
  });

  it("reuses an existing stripe_customer_id (no new customer)", async () => {
    h.getAuthedHost.mockResolvedValue({
      ok: true,
      host: { id: "h1", user_id: "u1", stripe_customer_id: "cus_existing" },
    });
    await POST(makeReq());
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" }),
    );
  });

  it("never sets payment_method_types (dynamic payment methods)", async () => {
    h.getAuthedHost.mockResolvedValue({
      ok: true,
      host: { id: "h1", user_id: "u1", stripe_customer_id: "cus_existing" },
    });
    await POST(makeReq());
    expect(h.createSession.mock.calls[0]![0]).not.toHaveProperty("payment_method_types");
  });
});
