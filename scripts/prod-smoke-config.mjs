export const DEFAULT_GEN_TIMEOUT_MS = 240_000;

export function genTimeoutFromEnv(env = process.env) {
  const raw = env.SMOKE_GEN_TIMEOUT_MS;
  if (!raw) return DEFAULT_GEN_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GEN_TIMEOUT_MS;
  }
  return parsed;
}
