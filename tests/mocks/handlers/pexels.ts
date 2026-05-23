// MSW handler for the Pexels Photos API.
//
// The `pexels` npm SDK constructs URLs by joining its `photo` base
// (`https://api.pexels.com/v1/`) with the endpoint path (`/search`),
// resulting in `https://api.pexels.com/v1//search?...` — note the
// doubled slash. MSW matches by pathname literally, so we register both
// the doubled-slash form (what the SDK actually emits) and the canonical
// form (in case anything calls the URL directly).
//
// The app also might hit /curated, /photos/:id, or /collections/* via
// the SDK depending on the codepath; for the test harness today we only
// need /search, but we provide a fallback that returns the same canned
// payload so a stray request never blows up the test.

import { http, HttpResponse } from "msw";

import { PEXELS_RESPONSE } from "../fixtures/pexels-results";

const searchResponse = () => HttpResponse.json(PEXELS_RESPONSE);

export const pexelsHandlers = [
  // Double-slash form emitted by the pexels SDK.
  http.get("https://api.pexels.com/v1//search", searchResponse),
  // Canonical form for any direct fetches.
  http.get("https://api.pexels.com/v1/search", searchResponse),
  // Catch-all for other photo endpoints (curated, show by id, etc.) so a
  // misrouted request returns a non-empty payload instead of a network
  // error. Keep it minimal — the only field downstream code reads here is
  // `photos[]`.
  http.get("https://api.pexels.com/v1/curated", searchResponse),
];
