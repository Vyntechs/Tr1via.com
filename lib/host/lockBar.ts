// Where the pick screen's Lock button sits, so the notes that float at the
// bottom of the screen (error toast, board-refresh note, the "create a
// password after the show" pill) can sit above it instead of on top of it.
//
// Phone: the Lock bar is pinned full width at the bottom of the screen
// (HostGenPick). It is about 100px tall plus the iPhone safe area, so the
// cards and the notes keep this much room under them (add the safe area).
// Desktop: Lock sits at the foot of the YOUR BOARD sidebar, bottom right,
// with its top about 95px above the window bottom. Notes start above that.
//
// Kept in this small file (not HostGenPick) so the host layout's pill can
// read it without loading the whole pick screen.

export const PICK_LOCK_PHONE_CLEARANCE = 120;
export const PICK_LOCK_DESKTOP_CLEARANCE = 130;

/** Same breakpoint HostGenPick and LaptopShell switch to the phone layout at. */
export const PICK_PHONE_QUERY = "(max-width: 860px)";

/** CSS bottom offset that clears the phone Lock bar. */
export const PICK_LOCK_PHONE_BOTTOM = `calc(${PICK_LOCK_PHONE_CLEARANCE}px + env(safe-area-inset-bottom))`;

/** True on the pick screen (/host/setup/<night>/pick/<category>), the only page with the Lock bar. */
export function isPickScreenPath(pathname: string): boolean {
  return /^\/host\/setup\/[^/]+\/pick\/[^/]+\/?$/.test(pathname);
}
