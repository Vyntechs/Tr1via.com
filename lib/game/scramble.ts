/**
 * Per-player scrambled answer order.
 *
 * The host's canonical question stores answers as a fixed array of 4 strings
 * with one canonical correctIndex (0..3). On each player's phone we want to
 * present the same 4 strings in a per-player order so cheating by glance is
 * blocked. The scramble MUST be deterministic given (questionId, playerId):
 * the server has to reproduce it when validating a submitted answer ("did
 * the player tap the slot that maps to the correct canonical index?").
 *
 * Implementation: hash (questionId + ":" + playerId) into a 32-bit seed,
 * feed it to Mulberry32 (a fast, simple, well-distributed PRNG), then
 * Fisher-Yates shuffle [0,1,2,3]. No external dependencies; deterministic
 * across Node, browser, and edge runtimes since we only use standard JS
 * arithmetic on 32-bit integers.
 */

const STRING_DELIMITER = ":";

/**
 * FNV-1a 32-bit hash of a UTF-16 code-point stream. Used as the seed for
 * Mulberry32. Operates entirely in unsigned-32 space via `>>> 0`.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit multiplication via Math.imul; FNV prime = 16777619.
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 — a small, fast PRNG that produces a uniformly distributed
 * float in [0, 1). Identical implementation across all runtimes since it
 * uses only `Math.imul` and bitwise ops on 32-bit integers.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Produce the canonical scramble for one player on one question.
 *
 * Returns a 4-tuple where `scramble[slotZeroBased]` is the canonical answer
 * index that the player sees in that slot. So if the canonical correctIndex
 * is 1 and the scramble is [2, 1, 0, 3], the correct answer appears in
 * slot 2 on the phone (1-based) — which `correctSlotFor` computes.
 *
 * Determinism: the same (questionId, playerId) ALWAYS returns the same
 * scramble. The server uses this to verify a player's submission carried
 * the scramble it should have seen.
 */
export function scrambleFor(
  questionId: string,
  playerId: string
): [number, number, number, number] {
  const seed = fnv1a(questionId + STRING_DELIMITER + playerId);
  const rng = mulberry32(seed);
  const arr: [number, number, number, number] = [0, 1, 2, 3];
  // Fisher-Yates shuffle, in-place on a 4-element array.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as number;
    arr[i] = arr[j] as number;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Map the canonical correctIndex into a 1-based slot on the player's phone.
 *
 * Used in UI to highlight "you tapped slot N" and to compute server-side
 * which slot the correct answer landed in for telemetry. Returns 1..4.
 */
export function correctSlotFor(scramble: number[], correctIndex: number): number {
  return scramble.indexOf(correctIndex) + 1;
}
