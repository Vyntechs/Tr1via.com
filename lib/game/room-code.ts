/**
 * 6-character room codes for joining a TR1VIA night.
 *
 * Alphabet is Crockford-style ambiguity-free (32 chars, no 0/O/1/I/L) so
 * a player squinting at a TV across a noisy room can read the code aloud
 * without confusion. Codes are stored undotted (e.g. "K9PR4M") and rendered
 * with a middle dot for human chunking (e.g. "K9P·R4M").
 *
 * 6 chars × 32 = ~10^9 codes. Per-night uniqueness is enforced by a DB
 * unique index; on a hash-conflict the API retries until it generates a
 * fresh one (very rare given the keyspace).
 */
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" as const;
const CODE_LENGTH = 6;
const MIDDLE_DOT = "·"; // ·

/**
 * Generate a fresh random 6-character room code from the ambiguity-free
 * alphabet. Uses Web Crypto when available (browser + Node 19+) and falls
 * back to Math.random() — fallback is safe because uniqueness is enforced
 * server-side via a DB index, not by the randomness alone.
 */
export function newRoomCode(): string {
  const out: string[] = new Array(CODE_LENGTH);
  const cryptoLike =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto
      : undefined;
  if (cryptoLike?.getRandomValues) {
    const buf = new Uint32Array(CODE_LENGTH);
    cryptoLike.getRandomValues(buf);
    for (let i = 0; i < CODE_LENGTH; i++) {
      out[i] = ALPHABET[(buf[i] as number) % ALPHABET.length] as string;
    }
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) {
      out[i] = ALPHABET[Math.floor(Math.random() * ALPHABET.length)] as string;
    }
  }
  return out.join("");
}

/**
 * Format a stored room code for display: inserts a middle dot at position 3.
 *
 * Length-tolerant: codes that aren't 6 chars get returned uppercased without
 * a dot (defensive — never break the UI if the DB has bad data). Always
 * uppercases input so lowercase user input also formats correctly.
 */
export function formatRoomCode(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== CODE_LENGTH) return upper;
  return upper.slice(0, 3) + MIDDLE_DOT + upper.slice(3);
}

/**
 * Parse a user- or display-form room code into the stored form.
 *
 * Strips all whitespace and middle dots, then uppercases. Lets the join
 * input field accept any combination of "K9PR4M", "k9pr4m", "K9·PR4M",
 * "K9 PR 4M", etc. — they all normalize to the same lookup key.
 */
export function parseRoomCode(formatted: string): string {
  return formatted.replace(/[\s·]/g, "").toUpperCase();
}

/**
 * Strict validator for stored room codes.
 *
 * Returns true only for exactly 6 ALPHABET characters — not the formatted
 * form, not lowercase, not whitespace-padded. Use after parseRoomCode().
 */
export function isValidRoomCode(code: string): boolean {
  if (typeof code !== "string") return false;
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
