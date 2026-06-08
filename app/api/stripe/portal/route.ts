// POST /api/stripe/portal — open the Stripe Customer Portal for the signed-in
// host (manage card, view invoices, cancel). Returns { url } to redirect to.
//
// Requires an existing Stripe customer — a host who never started checkout has
// nothing to manage, so we 400 rather than create an empty customer.

import { type NextRequest } from "next/server";

import { getAuthedHost } from "@/lib/api/auth";
import { getStripe } from "@/lib/billing/stripe";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/lib/api/responses";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await getAuthedHost();
  if (!auth.ok) {
    return auth.status === 401 ? unauthorized(auth.error) : forbidden(auth.error);
  }
  if (!auth.host.stripe_customer_id) {
    return badRequest("no subscription to manage");
  }

  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const session = await getStripe().billingPortal.sessions.create({
    customer: auth.host.stripe_customer_id,
    return_url: `${origin}/host`,
  });
  if (!session.url) return serverError("could not open billing portal");
  return ok({ url: session.url });
}
