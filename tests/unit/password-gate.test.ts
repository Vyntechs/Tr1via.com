// Pure "Create your password" gate rules (lib/auth/password-gate.ts).
//
// Proves: in-show routes (/host/live, /host/phone) are never interrupted;
// the prompt page itself never loops; the founder is always asked; other
// hosts only when the founder's per-host switch is "on"; explicit "off"
// always wins; a set password ends the prompt.

import { describe, expect, it } from "vitest";
import {
  checkNewPassword,
  hasPassword,
  isInShowPath,
  needsFounderCheck,
  passwordGateRedirect,
  passwordPromptSetting,
  setPasswordReturnPath,
} from "@/lib/auth/password-gate";

// A fixed "password saved at" time for the marker (built, not a literal).
const SET_AT = new Date(Date.UTC(2026, 8, 27, 12)).toISOString();
const NO_PW = {};
const WITH_PW = { password_set_at: SET_AT };
const PROMPT_ON = { password_prompt: "on" };
const PROMPT_OFF = { password_prompt: "off" };

describe("isInShowPath", () => {
  it.each([
    ["/host/live/night-1", true],
    ["/host/live", true],
    ["/host/phone/night-1", true],
    ["/host/phone", true],
    ["/host/liveish", false],
    ["/host/setup/night-1", false],
    ["/host", false],
    ["/host/admin", false],
  ])("%s → %s", (path, expected) => {
    expect(isInShowPath(path)).toBe(expected);
  });
});

describe("passwordGateRedirect", () => {
  it("sends the founder (no password) from the dashboard to set-password with next", () => {
    expect(
      passwordGateRedirect({ pathname: "/host", appMetadata: NO_PW, isFounder: true }),
    ).toBe("/host/set-password?next=%2Fhost");
  });

  it("keeps the query string in next", () => {
    expect(
      passwordGateRedirect({
        pathname: "/host/setup/n1/topic",
        search: "?slot=2",
        appMetadata: NO_PW,
        isFounder: true,
      }),
    ).toBe(`/host/set-password?next=${encodeURIComponent("/host/setup/n1/topic?slot=2")}`);
  });

  it.each(["/host/live/night-1", "/host/phone/night-1", "/host/live", "/host/phone"])(
    "never interrupts an in-show route (%s), even for the founder or a host switched on",
    (pathname) => {
      expect(passwordGateRedirect({ pathname, appMetadata: NO_PW, isFounder: true })).toBeNull();
      expect(
        passwordGateRedirect({ pathname, appMetadata: PROMPT_ON, isFounder: false }),
      ).toBeNull();
    },
  );

  it("never redirects the set-password page to itself", () => {
    expect(
      passwordGateRedirect({ pathname: "/host/set-password", appMetadata: NO_PW, isFounder: true }),
    ).toBeNull();
  });

  it("ignores non-host pages", () => {
    expect(passwordGateRedirect({ pathname: "/login", appMetadata: NO_PW, isFounder: true })).toBeNull();
    expect(passwordGateRedirect({ pathname: "/tv/ABC123", appMetadata: NO_PW, isFounder: true })).toBeNull();
    expect(passwordGateRedirect({ pathname: "/hostile", appMetadata: NO_PW, isFounder: true })).toBeNull();
  });

  it("leaves an existing host alone when the founder never set the switch (default off)", () => {
    expect(
      passwordGateRedirect({ pathname: "/host", appMetadata: NO_PW, isFounder: false }),
    ).toBeNull();
    expect(
      passwordGateRedirect({ pathname: "/host", appMetadata: null, isFounder: false }),
    ).toBeNull();
  });

  it("asks a host whose switch is on", () => {
    expect(
      passwordGateRedirect({ pathname: "/host/setup/n1", appMetadata: PROMPT_ON, isFounder: false }),
    ).toBe(`/host/set-password?next=${encodeURIComponent("/host/setup/n1")}`);
  });

  it("an explicit off wins, even for the founder", () => {
    expect(
      passwordGateRedirect({ pathname: "/host", appMetadata: PROMPT_OFF, isFounder: true }),
    ).toBeNull();
  });

  it("stops asking once a password is set", () => {
    expect(
      passwordGateRedirect({
        pathname: "/host",
        appMetadata: { ...WITH_PW, ...PROMPT_ON },
        isFounder: true,
      }),
    ).toBeNull();
  });
});

describe("needsFounderCheck", () => {
  it("only asks for the hosts lookup when it can change the answer", () => {
    expect(needsFounderCheck("/host", NO_PW)).toBe(true);
    expect(needsFounderCheck("/host", WITH_PW)).toBe(false);
    expect(needsFounderCheck("/host", PROMPT_ON)).toBe(false);
    expect(needsFounderCheck("/host", PROMPT_OFF)).toBe(false);
    expect(needsFounderCheck("/host/live/n1", NO_PW)).toBe(false);
    expect(needsFounderCheck("/host/phone/n1", NO_PW)).toBe(false);
    expect(needsFounderCheck("/host/set-password", NO_PW)).toBe(false);
  });
});

describe("marker readers", () => {
  it("hasPassword needs a non-empty string marker", () => {
    expect(hasPassword(WITH_PW)).toBe(true);
    expect(hasPassword({ password_set_at: "" })).toBe(false);
    expect(hasPassword({ password_set_at: true })).toBe(false);
    expect(hasPassword(undefined)).toBe(false);
  });

  it("passwordPromptSetting only accepts on/off", () => {
    expect(passwordPromptSetting(PROMPT_ON)).toBe("on");
    expect(passwordPromptSetting(PROMPT_OFF)).toBe("off");
    expect(passwordPromptSetting({ password_prompt: "yes" })).toBeNull();
    expect(passwordPromptSetting(null)).toBeNull();
  });
});

describe("setPasswordReturnPath", () => {
  it.each([
    [null, "/host"],
    ["/host/setup/n1", "/host/setup/n1"],
    ["/host/set-password", "/host"],
    ["/host/set-password?next=/host", "/host"],
    ["//evil.test/host", "/host"],
    ["https://evil.test/host", "/host"],
    ["/pricing", "/host"],
  ])("%s → %s", (next, expected) => {
    expect(setPasswordReturnPath(next)).toBe(expected);
  });
});

describe("checkNewPassword", () => {
  it("needs at least 8 characters", () => {
    expect(checkNewPassword("short", "short")).toMatchObject({ ok: false, field: "password" });
  });
  it("needs both boxes to match", () => {
    expect(checkNewPassword("longenough", "longenougH")).toMatchObject({ ok: false, field: "confirm" });
  });
  it("rejects more than 72 characters", () => {
    const long = "a".repeat(73);
    expect(checkNewPassword(long, long)).toMatchObject({ ok: false, field: "password" });
  });
  it("accepts a matching 8+ character password", () => {
    expect(checkNewPassword("trivia-night", "trivia-night")).toEqual({ ok: true });
  });
});
