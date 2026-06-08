// POST /api/stripe/checkout — start a Stripe Checkout subscription for the
// signed-in host. Returns { url } for the client to redirect to.
//
// Ensures the host has a Stripe customer (creating + storing one on first use),
// then opens a subscription Checkout Session for the Trivia Nerd monthly price.
// No payment_method_types — Stripe shows dynamic payment methods from the
// dashboard. The webhook (not this route) is what flips entitlement on payment.

import { type NextRequest } from "next/server";

import { getAuthedHost } from "@/lib/api/auth";
import { getStripe, monthlyPriceId } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden, serverError } from "@/lib/api/responses";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await getAuthedHost();
  if (!auth.ok) {
    return auth.status === 401 ? unauthorized(auth.error) : forbidden(auth.error);
  }
  const host = auth.host;

  const stripe = getStripe();
  const admin = getSupabaseAdmin();

  // Reuse the host's Stripe customer if we have one; otherwise create it (with
  // the host's email + a host_id pointer) and persist it so the webhook can map
  // future subscription events back to this host row.
  let customerId = host.stripe_customer_id;
  if (!customerId) {
    const { data } = await admin.auth.admin.getUserById(host.user_id);
    const customer = await stripe.customers.create({
      email: data?.user?.email ?? undefined,
      metadata: { host_id: host.id },
    });
    customerId = customer.id;
    const { error } = await admin
      .from("hosts")
      .update({ stripe_customer_id: customerId })
      .eq("id", host.id);
    if (error) return serverError(error.message);
  }

  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: monthlyPriceId(), quantity: 1 }],
    subscription_data: { metadata: { host_id: host.id } },
    success_url: `${origin}/host?upgraded=1`,
    cancel_url: `${origin}/host`,
  });
  if (!session.url) return serverError("could not start checkout");
  return ok({ url: session.url });
}
