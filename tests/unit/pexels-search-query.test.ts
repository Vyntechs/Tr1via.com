// @vitest-environment node
//
// What searchPexels really puts on the wire. The pexels package glues the search
// words into the address without escaping them, so these tests let the real
// package build the address and only pretend the network (a fake fetch, no real
// Pexels call, no key needed).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchPexels } from "@/lib/pexels/search";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.PEXELS_API_KEY = "test-key-not-real";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ photos: [], total_results: 0 }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentUrl(): string {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return String(fetchMock.mock.calls[0]![0]);
}

/** The part after the "?" exactly as sent, plus a check it went to Pexels' photo search. */
function sentQueryString(): string {
  const parsed = new URL(sentUrl());
  expect(parsed.origin).toBe("https://api.pexels.com");
  // The package joins "v1/" and "/search", so the path has a double slash today.
  expect(parsed.pathname.replace(/\/+/g, "/")).toBe("/v1/search");
  return parsed.search;
}

describe("searchPexels sends the search words intact", () => {
  it.each([
    ["Rock & Roll legends", "Rock%20%26%20Roll%20legends"],
    ["C# programming", "C%23%20programming"],
    ["100% juice", "100%25%20juice"],
    ["C++ code", "C%2B%2B%20code"],
    ["café au lait?", "caf%C3%A9%20au%20lait%3F"],
  ])("%s", async (query, escaped) => {
    await searchPexels(query, 5);

    // Exactly what we escaped, not escaped a second time.
    expect(sentQueryString()).toBe(`?query=${escaped}&per_page=5`);
    // And what the Pexels server will read back out of it.
    const parsed = new URL(sentUrl());
    expect(parsed.searchParams.get("query")).toBe(query);
    expect(parsed.searchParams.get("per_page")).toBe("5");
    expect([...parsed.searchParams.keys()]).toEqual(["query", "per_page"]);
  });

  it("a plain query is sent exactly as before", async () => {
    await searchPexels("alaska coastline aerial", 12);

    expect(sentQueryString()).toBe("?query=alaska%20coastline%20aerial&per_page=12");
    // Before the fix the package sent the spaces raw and fetch turned them into
    // %20 itself; the address that actually goes out is the same.
    const before = new URL(
      "https://api.pexels.com/v1//search?query=alaska coastline aerial&per_page=12",
    );
    expect(new URL(sentUrl()).href).toBe(before.href);
  });

  it("still trims the words and caps per_page at 12", async () => {
    await searchPexels("  sunset  ", 99);

    expect(sentQueryString()).toBe("?query=sunset&per_page=12");
  });

  it("does not search at all for blank words", async () => {
    await expect(searchPexels("   ")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the key in the Authorization header and nowhere in the address", async () => {
    await searchPexels("sunset");

    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("test-key-not-real");
    expect(sentUrl()).not.toContain("test-key-not-real");
  });
});
