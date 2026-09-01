export const DEFAULT_GEN_TIMEOUT_MS = 240_000;

export function canonicalPickAssignments(candidates) {
  if (candidates.length < 7) {
    throw new Error(`expected at least 7 candidates, got ${candidates.length}`);
  }
  return candidates.slice(0, 7).map((candidate, index) => ({
    id: candidate.id,
    pointValue: (index + 1) * 100,
  }));
}

export function genTimeoutFromEnv(env = process.env) {
  const raw = env.SMOKE_GEN_TIMEOUT_MS;
  if (!raw) return DEFAULT_GEN_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GEN_TIMEOUT_MS;
  }
  return parsed;
}
