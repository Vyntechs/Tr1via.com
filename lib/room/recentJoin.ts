// recentJoin — "this phone was in this room a little while ago", kept across a
// reload. It only decides how long a phone with no room in memory waits before
// the switch-to-hotspot screen: someone who was just playing gets "Reconnecting"
// first. It proves nothing about the player; the signed cookie still does that.

const RECENT_MS = 12 * 60 * 60 * 1000; // longer than any night

const keyFor = (roomCode: string) => `tr1via:recent-join:${roomCode}`;

export function rememberRecentJoin(roomCode: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(roomCode), String(Date.now()));
  } catch {
    // Storage full or disabled: the phone just gets the hotspot screen sooner.
  }
}

export function hasRecentJoin(roomCode: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const at = Number(window.localStorage.getItem(keyFor(roomCode)));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RECENT_MS;
  } catch {
    return false;
  }
}
