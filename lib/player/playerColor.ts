// Per-player color — the "the room knows you" layer of the Magic Welcome.
//
// Each player who joins a night gets one of 10 hand-picked hex colors,
// derived deterministically from their playerId. The same playerId always
// produces the same color across every surface (host live console, venue
// TV, the joining player's own phone) — even if they reload the page,
// disconnect, or come back later.
//
// The palette is tuned to read well on the warm-dark pub-night default
// theme AND on the daylight light theme: each color has enough contrast
// against both #1B130C (default paper) and #F4E6C4 (daylight paper).
// Colors deliberately avoid the brand `accent` (#FF6A3D) and `pop`
// (#4ECDC4) hexes so the welcome tile doesn't smear into the rest of
// the TV chrome on the house theme.
//
// Why deterministic (not stored): keeps the v1 ship boundary tiny. No
// schema migration, no extra column, no race between the upsert and the
// broadcast. The mapping is pure: same id in → same color out, on every
// surface, forever.

/**
 * Hand-picked palette. 10 colors. Order matters — the hash bucket index
 * determines which color a player gets, so changing the order will
 * reassign colors to existing players.
 */
export const PLAYER_PALETTE: readonly string[] = [
  "#F2A02D", // marigold
  "#5AA8E0", // sky
  "#E64A8C", // raspberry
  "#7E8C2A", // olive
  "#A94ACC", // grape
  "#3FAE56", // emerald
  "#E8C46A", // honey
  "#7A4FCC", // violet
  "#F08C2A", // amber
  "#94A5BC", // steel
] as const;

/**
 * FNV-1a 32-bit hash. Deterministic, fast, zero deps. Same algorithm we
 * use elsewhere in the codebase for question scramble seeding so the
 * collision profile is already known.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication via Math.imul
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit
  return hash >>> 0;
}

/**
 * Returns the 0-indexed palette slot for this player. Stable per id.
 * Sent in the `player-joined` broadcast so receivers can render the
 * same color without re-hashing (and so future renames of the
 * algorithm don't desync producers and consumers mid-night).
 */
export function playerColorKey(playerId: string): number {
  if (!playerId) return 0;
  return fnv1a(playerId) % PLAYER_PALETTE.length;
}

/**
 * Returns the hex color for this player. Equivalent to
 * `PLAYER_PALETTE[playerColorKey(playerId)]` — provided as a convenience
 * for components that have just the playerId.
 */
export function playerColorHex(playerId: string): string {
  return PLAYER_PALETTE[playerColorKey(playerId)] ?? PLAYER_PALETTE[0]!;
}

/**
 * Returns the hex color for a given color key. Used by receivers that got
 * the colorKey out of the broadcast payload and want to skip the hash.
 */
export function colorHexFromKey(colorKey: number): string {
  if (!Number.isFinite(colorKey) || colorKey < 0) return PLAYER_PALETTE[0]!;
  return PLAYER_PALETTE[colorKey % PLAYER_PALETTE.length] ?? PLAYER_PALETTE[0]!;
}
