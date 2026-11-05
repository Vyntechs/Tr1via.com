// The two switches for the server closer, the alarm and the scoring repair.
//
//   LIVE_CLOSE_MODE   off | shadow | on. Anything else, or unset, is off.
//   LIVE_CLOSE_NIGHTS comma list of night ids. Unset or empty means every night.
//
// off: none of it runs. shadow: it logs what it would have done and writes
// nothing. on: it acts. Both are read at run time but only change with a
// redeploy, so they are between-shows tools, not a mid-show off switch.

export type LiveCloseMode = "off" | "shadow" | "on";

export function liveCloseModeFor(nightId: string): LiveCloseMode {
  const mode = process.env.LIVE_CLOSE_MODE;
  if (mode !== "on" && mode !== "shadow") return "off";
  const nights = (process.env.LIVE_CLOSE_NIGHTS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return nights.length === 0 || nights.includes(nightId) ? mode : "off";
}
