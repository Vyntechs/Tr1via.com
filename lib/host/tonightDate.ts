// Is a given night actually "tonight"?
//
// The host dashboard used to call its headliner "TONIGHT" unconditionally —
// it just grabbed the newest un-closed night, so a months-old leftover night
// still showed as tonight (the "TONIGHT · SUN MAY 31 on June 3" bug). This
// gate compares the night's date to the real clock so the word is only used
// when it's true.
//
// Compares calendar day in the same zone as the dashboard's date formatting
// (local Y/M/D), so the label stays consistent with the date shown next to it.

/**
 * True when `nightDate` falls on the same calendar day as `now`.
 *
 * @param nightDate the night's effective date — `scheduled_at ?? created_at`,
 *   accepted as an ISO string (how the row stores it) or a Date.
 * @param now the current moment.
 */
export function isNightToday(nightDate: string | Date, now: Date): boolean {
  const d = nightDate instanceof Date ? nightDate : new Date(nightDate);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
