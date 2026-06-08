// POST /api/stripe/webhook — the ONLY writer of host subscription state.
//
// Stripe calls this on every subscription lifecycle change. We verify the
// signature on the RAW body (anything unsigned/tampered is rejected), then
// idempotently mirror the subscription's status onto the host row via the
// service-role client. hostAIAccess (lib/api/entitlements) reads
// subscription_status to grant AI — so this is what turns a paid plan on/off.
//
// We handle only customer.subscription.{created,updated,deleted}: each carries
// the authoritative .status, so past_due (dunning grace, still entitled) and
// canceled (no longer entitled) both arrive here. A separate
// invoice.payment_failed handler would be redundant — its effect reaches us as
// a subscription.updated → past_due.

import type Stripe from "stripe";

import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, badRequest, serverError } from "@/lib/api/responses";

export const runtime = "nodejs";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return serverError("billing not configured");

  const signature = req.headers.get("stripe-signature");
  if (!signature) return badRequest("missing signature");

  const raw = await req.text(); // RAW body — required for signature verification
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return badRequest("signature verification failed");
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    // In the current Stripe API current_period_end lives on the subscription
    // item, not the subscription root.
    const periodEndUnix = sub.items?.data?.[0]?.current_period_end ?? null;

    const { error } = await getSupabaseAdmin()
      .from("hosts")
      .update({
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        current_period_end: periodEndUnix
          ? new Date(periodEndUnix * 1000).toISOString()
          : null,
      })
      .eq("stripe_customer_id", customerId);
    if (error) return serverError(error.message);
  }

  return ok({ received: true });
}
