import { describe, it, expect } from "vitest";
import { signDeviceCookie, verifyDeviceCookie } from "@/lib/auth/device-cookie";

const SECRET = "test-secret-please-use-openssl-rand-base64-48-in-prod";
const DEVICE_ID = "9e9d8b1e-2f6a-4c2b-9e0d-7f1b6a3c4d5e";

describe("signDeviceCookie", () => {
  it("returns deviceId.signature format", () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    expect(signed.startsWith(`${DEVICE_ID}.`)).toBe(true);
    const sig = signed.slice(DEVICE_ID.length + 1);
    expect(sig.length).toBeGreaterThan(0);
    // base64url uses only [A-Za-z0-9_-], no '=' padding.
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is deterministic for the same (deviceId, secret)", () => {
    const a = signDeviceCookie(DEVICE_ID, SECRET);
    const b = signDeviceCookie(DEVICE_ID, SECRET);
    expect(a).toBe(b);
  });

  it("differs across secrets", () => {
    const a = signDeviceCookie(DEVICE_ID, "secret-one");
    const b = signDeviceCookie(DEVICE_ID, "secret-two");
    expect(a).not.toBe(b);
  });

  it("differs across deviceIds", () => {
    const a = signDeviceCookie("aaa-aaa", SECRET);
    const b = signDeviceCookie("bbb-bbb", SECRET);
    expect(a).not.toBe(b);
  });

  it("throws on empty deviceId or secret", () => {
    expect(() => signDeviceCookie("", SECRET)).toThrow();
    expect(() => signDeviceCookie(DEVICE_ID, "")).toThrow();
  });
});

describe("verifyDeviceCookie", () => {
  it("round-trips: verify(sign(id, secret), secret) === id", () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    expect(verifyDeviceCookie(signed, SECRET)).toBe(DEVICE_ID);
  });

  it("returns null when the signature is tampered", () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    // Flip the last char (or wrap if it was 'A').
    const last = signed.slice(-1);
    const replacement = last === "A" ? "B" : "A";
    const tampered = signed.slice(0, -1) + replacement;
    expect(verifyDeviceCookie(tampered, SECRET)).toBeNull();
  });

  it("returns null when the deviceId is tampered", () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    // Swap one character of the deviceId portion.
    const sigStart = signed.lastIndexOf(".");
    const id = signed.slice(0, sigStart);
    const sig = signed.slice(sigStart + 1);
    const swapped = id.replace(/[0-9a-f]/, (c) => (c === "0" ? "1" : "0"));
    const tampered = `${swapped}.${sig}`;
    expect(verifyDeviceCookie(tampered, SECRET)).toBeNull();
  });

  it("returns null when verified with the wrong secret", () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    expect(verifyDeviceCookie(signed, "different-secret")).toBeNull();
  });

  it("returns null for empty / null / undefined cookie", () => {
    expect(verifyDeviceCookie("", SECRET)).toBeNull();
    expect(verifyDeviceCookie(null, SECRET)).toBeNull();
    expect(verifyDeviceCookie(undefined, SECRET)).toBeNull();
  });

  it("returns null when secret is empty", () => {
    const signed = signDeviceCookie(DEVICE_ID, SECRET);
    expect(verifyDeviceCookie(signed, "")).toBeNull();
  });

  it("returns null for malformed cookie (no separator)", () => {
    expect(verifyDeviceCookie("just-a-uuid-with-no-signature", SECRET)).toBeNull();
  });

  it("returns null when separator appears at the very start or end", () => {
    expect(verifyDeviceCookie(".sig-only", SECRET)).toBeNull();
    expect(verifyDeviceCookie("id-only.", SECRET)).toBeNull();
  });

  it("returns null when the signature is wildly the wrong length", () => {
    expect(verifyDeviceCookie(`${DEVICE_ID}.short`, SECRET)).toBeNull();
    expect(
      verifyDeviceCookie(`${DEVICE_ID}.${"x".repeat(200)}`, SECRET),
    ).toBeNull();
  });
});
