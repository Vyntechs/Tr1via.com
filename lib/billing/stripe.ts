// Server-only Stripe client + price lookup for the "Trivia Nerd" subscription.
//
// Mirrors the lib/supabase factories: a throw-on-missing env guard and a lazy
// singleton. NEVER import this from client code — the secret key must stay on
// the server. apiVersion is intentionally omitted so the installed SDK pins its
// own latest API version (avoids a brittle hardcoded version string).

import "server-only";
import Stripe from "stripe";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

let cached: Stripe | null = null;

/** The shared server-side Stripe client. Test vs live follows STRIPE_SECRET_KEY. */
export function getStripe(): Stripe {
  if (!cached) cached = new Stripe(env("STRIPE_SECRET_KEY"));
  return cached;
}

/** Recurring price id for Trivia Nerd ($4.99/mo). Monthly is the only plan. */
export function monthlyPriceId(): string {
  return env("STRIPE_PRICE_MONTHLY");
}
