// hostFetch — one request from a host button, with a bound on how long it can
// hang.
//
// On venue WiFi a reply can go missing while the server did the work. A plain
// fetch then waits forever: the button stays busy, and the host cannot tell
// whether the room moved. This gives up after 8s and says so with HostReplyLost.
// The timer also covers reading the reply's body, since a reply can stall there.
//
// It never retries. HostReplyLost means "may or may not have landed", so the
// caller re-reads the room and shows "Sent, checking". A reveal in particular is
// never re-sent by the app; only the host's own tap sends it again.

export const HOST_ACTION_TIMEOUT_MS = 8_000;

export const SENT_CHECKING_MESSAGE = "Sent, checking";

/** The request went out and no usable reply came back, so the outcome is unknown. */
export class HostReplyLost extends Error {
  constructor() {
    super(SENT_CHECKING_MESSAGE);
    this.name = "HostReplyLost";
  }
}

export async function hostFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOST_ACTION_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return new Response(body === "" ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    throw new HostReplyLost();
  } finally {
    clearTimeout(timer);
  }
}

// The server's wording in app/api/games/[id]/reveal/route.ts. Both mean a
// question is already up, so the host's board is behind and needs a re-read.
const REVEAL_ALREADY_DONE = ["question already revealed", "another question is already live"];

/** True when a reveal refusal is the board being behind, not a real failure. */
export function isRevealAlreadyDone(serverError: string | null | undefined): boolean {
  if (!serverError) return false;
  const message = serverError.toLowerCase();
  return REVEAL_ALREADY_DONE.some((wording) => message.includes(wording));
}
