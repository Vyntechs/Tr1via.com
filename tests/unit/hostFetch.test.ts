import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_ACTION_TIMEOUT_MS,
  hostFetch,
  HostReplyLost,
  isRevealAlreadyDone,
} from "@/lib/host/hostFetch";

const hung = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });

describe("hostFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hands back a server refusal with its status and body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 409 }),
    );

    const response = await hostFetch("/api/x", { method: "POST" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "nope" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/x",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("copes with a reply that has no body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await hostFetch("/api/x");

    expect(response.status).toBe(204);
  });

  it("gives up at 8s, not before", async () => {
    fetchMock.mockImplementation(hung);
    const settled = vi.fn();
    const pending = hostFetch("/api/x").catch((err) => {
      settled(err);
    });

    await vi.advanceTimersByTimeAsync(HOST_ACTION_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled.mock.calls[0][0]).toBeInstanceOf(HostReplyLost);
  });

  it("the 8s also covers a reply whose body stalls after the headers", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const response = new Response("{}", { status: 200 });
      response.text = () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      return response;
    });
    const settled = vi.fn();
    const pending = hostFetch("/api/x").catch((err) => {
      settled(err);
    });

    await vi.advanceTimersByTimeAsync(HOST_ACTION_TIMEOUT_MS);
    await pending;

    expect(settled.mock.calls[0][0]).toBeInstanceOf(HostReplyLost);
  });

  it("treats a dropped connection as a lost reply, since it may have landed", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(hostFetch("/api/x")).rejects.toBeInstanceOf(HostReplyLost);
  });

  it("sends once and never retries on its own", async () => {
    fetchMock.mockImplementation(hung);
    const pending = hostFetch("/api/x").catch(() => undefined);

    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("isRevealAlreadyDone", () => {
  it.each([
    "question already revealed",
    "another question is already live in this game",
  ])("reads %s as the board being behind", (message) => {
    expect(isRevealAlreadyDone(message)).toBe(true);
  });

  it.each(["question is not on the board", "reveal failed", "", null, undefined])(
    "keeps %s as a real failure",
    (message) => {
      expect(isRevealAlreadyDone(message)).toBe(false);
    },
  );
});
