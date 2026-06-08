// Route test — POST /api/stripe/webhook.
//
// Proves: a real Stripe-signed subscription.updated event idempotently writes
// status to the host by stripe_customer_id; a bad signature is rejected (400)
// and writes nothing; a non-subscription event is acknowledged (200) with no
// write. We sign with the SDK's generateTestHeaderString so the route's real
// constructEvent verification runs.

import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const SECRET = "whsec_test_secret";
// Plain Stripe instance used to sign test payloads with the same secret the
// route verifies against (a different object than the route's, by design).
const signer = new Stripe("sk_test_dummy");

const h = vi.hoisted(() => ({ getStripe: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: h.getStripe }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({ from: h.from }) }));

import { POST } from "@/app/api/stripe/webhook/route";

let updateSpy: ReturnType<typeof vi.fn>;
let eqSpy: ReturnType<typeof vi.fn>;

function signedRequest(payload: string) {
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return new Request("http://test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header },
    body: payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  h.getStripe.mockReturnValue(signer);
  eqSpy = vi.fn().mockResolvedValue({ error: null });
  updateSpy = vi.fn().mockReturnValue({ eq: eqSpy });
  h.from.mockReturnValue({ update: updateSpy });
});

describe("POST /api/stripe/webhook", () => {
  it("writes subscription state on customer.subscription.updated", async () => {
    const payload = JSON.stringify({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          items: { data: [{ current_period_end: 1900000000 }] },
        },
      },
    });
    const res = await POST(signedRequest(payload));
    expect(res.status).toBe(200);
    expect(h.from).toHaveBeenCalledWith("hosts");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_status: "active",
        stripe_subscription_id: "sub_1",
        current_period_end: new Date(1900000000 * 1000).toISOString(),
      }),
    );
    expect(eqSpy).toHaveBeenCalledWith("stripe_customer_id", "cus_1");
  });

  it("rejects a bad signature with 400 and writes nothing", async () => {
    const bad = new Request("http://test/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: "{}",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("acknowledges a non-subscription event with no write", async () => {
    const payload = JSON.stringify({
      id: "evt_2",
      type: "customer.created",
      data: { object: { id: "cus_1" } },
    });
    const res = await POST(signedRequest(payload));
    expect(res.status).toBe(200);
    expect(h.from).not.toHaveBeenCalled();
  });
});
