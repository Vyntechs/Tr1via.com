// Demo roster for the lock-in TV variants. 21 of 32 have locked in by the
// time the variant is captured. Each name has its lock-in time relative to
// the question's reveal — used as the second-row chip in the pile-up tile.
//
// In production this is wired to live data; the gallery falls back to this
// shape so a name pile shows up without a Supabase round in flight.

export interface LockInTile {
  name: string;
  /** Time taken to lock in, e.g. "1.2s". Optional — pile-up variant displays it. */
  t?: string;
  /** Whether this tile represents the current viewer ("you"). Optional. */
  isYou?: boolean;
}

export const TR1VIA_LOCKIN_ROSTER: LockInTile[] = [
  { name: "Devon",  t: "1.2s" },
  { name: "Iris",   t: "1.4s" },
  { name: "Cole",   t: "1.8s" },
  { name: "Maya",   t: "2.3s" },
  { name: "Priya",  t: "2.8s" },
  { name: "Ezra",   t: "3.1s" },
  { name: "Nadia",  t: "3.4s" },
  { name: "Theo",   t: "3.7s" },
  { name: "Jules",  t: "4.1s" },
  { name: "Marcus", t: "4.5s" },
  { name: "Sara",   t: "5.0s" },
  { name: "Eli",    t: "5.4s" },
  { name: "Ana",    t: "5.8s" },
  { name: "June",   t: "6.2s" },
  { name: "Lex",    t: "6.5s" },
  { name: "Otis",   t: "6.8s" },
  { name: "Sam",    t: "7.0s" },
  { name: "Ren",    t: "7.4s" },
  { name: "Kai",    t: "7.8s" },
  { name: "Mira",   t: "8.1s" },
  { name: "Quinn",  t: "8.4s" },
];
