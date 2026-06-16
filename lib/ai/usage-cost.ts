// Single source of truth for Anthropic per-model token pricing + cost math.
//
// Created after a stale-price bug: scripts/benchmark-answer-correctness.mjs had
// hardcoded the deprecated Opus rate [15,75], inflating every cost estimate ~3x
// on the Opus slice. Both the live generation route and the benchmark read rates
// from HERE so the numbers can never silently drift again. Update prices in ONE
// place. Source: platform.claude.com/docs pricing (2026-06).
//
// Pure math — no `server-only`, so the .mjs benchmark can import it via tsx too.

/** $/million tokens, as { input, output }. */
export const MODEL_RATES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

/** Anthropic usage block. `input_tokens` is the UNCACHED remainder only —
 *  cache creation/read are reported separately and priced differently. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function rateFor(model: string): { in: number; out: number } | null {
  if (MODEL_RATES[model]) return MODEL_RATES[model];
  // Tolerate dated suffixes (e.g. "claude-haiku-4-5-20251001").
  const hit = Object.keys(MODEL_RATES).find((k) => model.startsWith(k));
  return hit ? MODEL_RATES[hit]! : null;
}

/**
 * USD cost of a single Anthropic call. Cache reads bill at ~0.1x input;
 * cache writes (5-min ephemeral) at ~1.25x input. Returns 0 for an unknown
 * model rather than throwing — cost logging must never break generation.
 */
export function costUsd(model: string, u: TokenUsage): number {
  const r = rateFor(model);
  if (!r) return 0;
  const freshIn = ((u.input_tokens ?? 0) / 1e6) * r.in;
  const cacheRead = ((u.cache_read_input_tokens ?? 0) / 1e6) * r.in * 0.1;
  const cacheWrite = ((u.cache_creation_input_tokens ?? 0) / 1e6) * r.in * 1.25;
  const out = ((u.output_tokens ?? 0) / 1e6) * r.out;
  return freshIn + cacheRead + cacheWrite + out;
}
