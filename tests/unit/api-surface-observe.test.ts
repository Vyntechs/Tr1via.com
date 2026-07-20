import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const deliveryMock = vi.hoisted(() => ({
  resolvePlayerObservationContext: vi.fn(),
  resolveTVObservationContext: vi.fn(),
  persistSurfaceObservation: vi.fn(),
  parseObservationRevision: vi.fn((value: unknown) => value),
}));

vi.mock("@/lib/api/gameDelivery", () => deliveryMock);

const revision = {
  runId: "44444444-4444-4444-4444-444444444444",
  roomRevision: 9,
  controlRevision: 4,
  playId: "55555555-5555-5555-5555-555555555555",
};

function request(path: string, body: unknown) {
  return new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("surface observation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliveryMock.resolvePlayerObservationContext.mockResolvedValue({
      ok: true,
      context: { nightId: "night", surfaceKind: "player", subjectKey: "opaque", canonical: revision },
    });
    deliveryMock.resolveTVObservationContext.mockResolvedValue({
      ok: true,
      context: { nightId: "night", surfaceKind: "tv", subjectKey: "opaque-tv", canonical: revision },
    });
    deliveryMock.persistSurfaceObservation.mockResolvedValue("accepted");
  });

  it("accepts a signed participating player with an empty no-store response", async () => {
    const { POST } = await import("@/app/api/room/[code]/observe/route");
    const response = await POST(request("/api/room/ABC234/observe", revision), {
      params: Promise.resolve({ code: "ABC234" }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(deliveryMock.persistSurfaceObservation).toHaveBeenCalledWith(
      expect.objectContaining({ subjectKey: "opaque", surfaceKind: "player" }),
      revision,
    );
  });

  it("denies an unsigned, removed, or unjoined player without leaking a body", async () => {
    deliveryMock.resolvePlayerObservationContext.mockResolvedValue({ ok: false, status: 403 });
    const { POST } = await import("@/app/api/room/[code]/observe/route");
    const response = await POST(request("/api/room/ABC234/observe", revision), {
      params: Promise.resolve({ code: "ABC234" }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(deliveryMock.persistSurfaceObservation).not.toHaveBeenCalled();
  });

  it("rejects a forged or stale canonical revision and never persists it", async () => {
    const { POST } = await import("@/app/api/room/[code]/observe/route");
    const response = await POST(
      request("/api/room/ABC234/observe", { ...revision, controlRevision: 3 }),
      { params: Promise.resolve({ code: "ABC234" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe("");
    expect(deliveryMock.persistSurfaceObservation).not.toHaveBeenCalled();
  });

  it("records one server-derived TV subject and treats rate limiting as accepted", async () => {
    deliveryMock.persistSurfaceObservation.mockResolvedValue("rate_limited");
    const { POST } = await import("@/app/api/tv/[code]/observe/route");
    const response = await POST(request("/api/tv/ABC234/observe", revision), {
      params: Promise.resolve({ code: "ABC234" }),
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(deliveryMock.persistSurfaceObservation).toHaveBeenCalledWith(
      expect.objectContaining({ subjectKey: "opaque-tv", surfaceKind: "tv" }),
      revision,
    );
  });

  it("does not let an anonymous or non-owner display claim TV delivery", async () => {
    deliveryMock.resolveTVObservationContext.mockResolvedValue({ ok: false, status: 403 });
    const { POST } = await import("@/app/api/tv/[code]/observe/route");
    const response = await POST(request("/api/tv/ABC234/observe", revision), {
      params: Promise.resolve({ code: "ABC234" }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(deliveryMock.persistSurfaceObservation).not.toHaveBeenCalled();
  });
});
