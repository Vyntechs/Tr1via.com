// Next.js instrumentation hook.
//
// Boots MSW inside the Next server process ONLY when MOCK_EXTERNAL=1 is
// set in the environment. In production deploys, MOCK_EXTERNAL is never
// set, so this is a no-op and real Anthropic + Pexels traffic flows
// through unhindered.
//
// MOCK_EXTERNAL is set exclusively by scripts/test-smoke.sh (Phase 8) —
// no developer should ever set it locally, and CI does not set it either.
// We additionally gate on NEXT_RUNTIME so the Edge runtime (which has no
// `msw/node`) never tries to import this module.

export async function register() {
  if (process.env.MOCK_EXTERNAL !== "1") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { mockServer } = await import("./tests/mocks/server");
  mockServer.listen({ onUnhandledRequest: "bypass" });
  // eslint-disable-next-line no-console
  console.log("[mocks] Anthropic + Pexels MSW handlers active");
}
