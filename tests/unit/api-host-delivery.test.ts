import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const deliveryMock = vi.hoisted(() => ({ readOwnedDeliveryReceipt: vi.fn() }));
vi.mock("@/lib/api/gameDelivery", () => deliveryMock);

describe("host game delivery route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only aggregate receipt and canonical revision to the owning host", async () => {
    deliveryMock.readOwnedDeliveryReceipt.mockResolvedValue({
      ok: true,
      body: {
        tv: "current",
        currentPhones: 30,
        recoveringPhones: 1,
        canonical: { runId: "run", roomRevision: 9, controlRevision: 4, playId: "play" },
      },
    });
    const { GET } = await import("@/app/api/host/rooms/[code]/delivery/route");
    const response = await GET(new NextRequest("http://test/api/host/rooms/ABC234/delivery"), {
      params: Promise.resolve({ code: "ABC234" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      tv: "current",
      currentPhones: 30,
      recoveringPhones: 1,
      canonical: { runId: "run", roomRevision: 9, controlRevision: 4, playId: "play" },
    });
    expect(JSON.stringify(body)).not.toMatch(/device|playerId|answer|choice|subject/i);
  });

  it("denies a non-owner without returning delivery data", async () => {
    deliveryMock.readOwnedDeliveryReceipt.mockResolvedValue({ ok: false, status: 403 });
    const { GET } = await import("@/app/api/host/rooms/[code]/delivery/route");
    const response = await GET(new NextRequest("http://test/api/host/rooms/ABC234/delivery"), {
      params: Promise.resolve({ code: "ABC234" }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
  });
});
