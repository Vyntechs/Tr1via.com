import "server-only";

import { createHmac } from "node:crypto";

export type PresentationAudience = "player" | "tv";
export type PresentationKind = "night" | "player";

/**
 * Stable, audience-scoped correlation key for public/signed presentation data.
 * Raw database identifiers remain server-side and separate audiences cannot
 * correlate the same record by comparing keys.
 */
export function presentationKey(
  secret: string,
  audience: PresentationAudience,
  kind: PresentationKind,
  nightId: string,
  rawId: string,
): string {
  if (!secret) throw new Error("presentationKey: secret is required");
  return `pk_${createHmac("sha256", secret)
    .update(`tr1via:presentation:v1:${audience}:${kind}:${nightId}:${rawId}`)
    .digest("base64url")}`;
}
