import { describe, it, expect, vi, afterEach } from "vitest";
import { makeInternalFetch } from "@/lib/api/internalFetch";

function fakeReq(cookie: string) {
  return {
    url: "https://app.test/api/founder/build-game",
    headers: {
      get: (k: string) => (k.toLowerCase() === "cookie" ? cookie : null),
    },
  } as unknown as import("next/server").NextRequest;
}

afterEach(() => vi.restoreAllMocks());

describe("makeInternalFetch", () => {
  it("forwards the inbound cookies and absorbs Set-Cookie across calls", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).Cookie);
      return {
        ok: true,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === "set-cookie" ? "sb-token=NEW; Path=/" : null,
        },
        json: async () => ({}),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const call = makeInternalFetch(fakeReq("sb-token=OLD; other=1"));
    await call("/api/nights", { method: "POST", body: "{}" });
    await call("/api/categories", { method: "POST", body: "{}" });

    expect(seen[0]).toContain("sb-token=OLD");
    expect(seen[0]).toContain("other=1");
    // Second call carries the refreshed token from the first response.
    expect(seen[1]).toContain("sb-token=NEW");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/api/nights",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
