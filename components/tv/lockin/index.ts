// Barrel export for the TV lock-in choreography. Two pieces:
//   - LockInBase     — shared scaffold (question + answers + timer) every
//                      variant rides on.
//   - LockInPileUp   — the chosen variant: weighty tiles stack up. Driven by
//                      a `tiles` prop so live data can replace the demo roster.
// Plus the demo roster + tile type for callers that want to test or compose.

export { LockInBase } from "./LockInBase";
export type { LockInBaseProps } from "./LockInBase";

export { LockInPileUp } from "./LockInPileUp";
export type { LockInPileUpProps } from "./LockInPileUp";

export { TR1VIA_LOCKIN_ROSTER } from "./roster";
export type { LockInTile } from "./roster";
