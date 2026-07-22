// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: auth.createServerClient,
}));

import { middleware } from "@/middleware";

describe("middleware API isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    auth.getUser.mockResolvedValue({ data: { user: null } });
    auth.createServerClient.mockReturnValue({ auth: { getUser: auth.getUser } });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("does not run host authentication for API traffic", async () => {
    const response = await middleware(
      new NextRequest("https://tr1via.com/api/room/Z8RJDJ/snapshot"),
    );

    expect(response.status).toBe(200);
    expect(auth.createServerClient).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("still authenticates and gates host pages", async () => {
    const response = await middleware(
      new NextRequest("https://tr1via.com/host/live/night-id"),
    );

    expect(auth.createServerClient).toHaveBeenCalledOnce();
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tr1via.com/login?next=%2Fhost%2Flive%2Fnight-id",
    );
  });
});
