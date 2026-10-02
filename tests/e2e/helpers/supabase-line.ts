// The browser's DIRECT line to Supabase, for the venue-WiFi outage specs.
//
// Those specs simulate a venue network that blocks browser→Supabase while the
// site itself stays up. They used to match only hosted projects
// ("**/*.supabase.co/**"), but local E2E runs against the local stack in
// .env.local (http://127.0.0.1:54321), so the block silently matched nothing
// and the "outage" never happened. Match both, by host (scheme-agnostic), so
// the block is real wherever the suite runs. Same-origin app routes (/api/...)
// never match.

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const configuredHost = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
})();

/** True for any browser request that goes straight to Supabase. */
export function isDirectSupabaseRequest(url: URL): boolean {
  return (
    url.hostname.endsWith(".supabase.co") ||
    (configuredHost !== null && url.host === configuredHost)
  );
}
