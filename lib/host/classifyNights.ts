// Classify a host's nights for the dashboard. Input MUST be newest-first
// (created_at desc) — the same order app/host/page.tsx already fetches.
//
// tonight       = the most-recent night (the headliner; its CTA adapts to
//                 the night's state elsewhere). Shown in neither list.
// previousGames = older nights that were actually RUN (opened_at != null) →
//                 read-only recap. opened_at is the reliable "ran" signal
//                 (closed_at is never written in prod).
// inSetup       = older nights never run (opened_at == null) → continue/delete.
export interface ClassifiableNight {
  id: string;
  opened_at: string | null;
}

export interface NightClassification<T extends ClassifiableNight> {
  tonight: T | null;
  previousGames: T[];
  inSetup: T[];
}

export function classifyNights<T extends ClassifiableNight>(
  nights: T[],
): NightClassification<T> {
  const [tonight = null, ...rest] = nights;
  return {
    tonight,
    previousGames: rest.filter((ngt) => ngt.opened_at !== null),
    inSetup: rest.filter((ngt) => ngt.opened_at === null),
  };
}
