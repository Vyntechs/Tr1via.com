import { beforeEach, describe, expect, it, vi } from "vitest";

import { signDeviceCookie, verifyDeviceCookie } from "@/lib/auth/device-cookie";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: h.get, set: h.set })),
}));

import { POST } from "@/app/api/session/init/route";

const SECRET = "test-session-secret-with-enough-random-looking-characters";
const DEVICE_ID = "9e9d8b1e-2f6a-4c2b-9e0d-7f1b6a3c4d5e";

describe("POST /api/session/init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = SECRET;
  });

  it("mints an HTTP-only same-site cookie and returns readiness only", async () => {
    h.get.mockReturnValue(undefined);

    const response = await POST();
    const body = await response.json();

    expect(body).toEqual({ ready: true });
    expect(h.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = h.set.mock.calls[0] ?? [];
    expect(name).toBe("tr1via_device");
    expect(verifyDeviceCookie(value, SECRET)).not.toBeNull();
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    expect(JSON.stringify(body)).not.toContain("deviceId");
  });

  it("replaces a tampered cookie without returning either identity", async () => {
    const tampered = `${DEVICE_ID}.tampered-signature`;
    h.get.mockReturnValue({ value: tampered });

    const response = await POST();
    const bodyText = await response.text();

    expect(JSON.parse(bodyText)).toEqual({ ready: true });
    const [, replacement] = h.set.mock.calls[0] ?? [];
    expect(replacement).not.toBe(tampered);
    expect(verifyDeviceCookie(replacement, SECRET)).not.toBeNull();
    expect(bodyText).not.toContain(DEVICE_ID);
    expect(bodyText).not.toContain(tampered);
  });

  it("preserves a verified cookie without leaking its value", async () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    h.get.mockReturnValue({ value: signed });

    const response = await POST();
    const bodyText = await response.text();

    expect(JSON.parse(bodyText)).toEqual({ ready: true });
    expect(h.set).not.toHaveBeenCalled();
    expect(bodyText).not.toContain(DEVICE_ID);
    expect(bodyText).not.toContain(signed);
  });
});
