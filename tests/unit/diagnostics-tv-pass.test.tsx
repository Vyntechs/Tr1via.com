// The venue TV's signed pass for the diagnostic log: how it is made, when it is
// good, who is given one, and how the TV page hands it to the reporter.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { render } from "@testing-library/react";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";

const writeMock = vi.hoisted(() => ({
  lookupRoomNight: vi.fn(),
  peekRoomNight: vi.fn(),
  isLoggingPaused: vi.fn(),
}));
vi.mock("@/lib/diagnostics/write", () => writeMock);

import { __resetTvPassLimitsForTests, issueTvPassForRoom, signTvPass, verifyTvPass } from "@/lib/diagnostics/tvPass";
import { DIAG_TV_PASS_TTL_MS } from "@/lib/diagnostics/config";
import { DiagTvPassSetter } from "@/components/diagnostics/DiagTvPassSetter";
import { DiagTvPass } from "@/components/diagnostics/DiagTvPass";
import { __resetDiagClientForTests, getDiagTvPass } from "@/lib/diagnostics/client";
import { signDeviceCookie, verifyDeviceCookie } from "@/lib/auth/device-cookie";
import TVLayout from "@/app/tv/[code]/layout";

const SECRET = "test-session-secret-0123456789";
const NIGHT = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const ENV = { SESSION_SECRET: SECRET };
const NOW = Date.parse("2026-10-07T23:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("SESSION_SECRET", SECRET);
  writeMock.lookupRoomNight.mockResolvedValue(NIGHT);
  writeMock.peekRoomNight.mockReturnValue(undefined); // nothing known about the room yet
  writeMock.isLoggingPaused.mockReturnValue(false);
  __resetTvPassLimitsForTests();
  __resetDiagClientForTests();
});
afterEach(() => vi.unstubAllEnvs());

describe("signTvPass / verifyTvPass", () => {
  it("makes a pass that names one night and verifies back to it", () => {
    const pass = signTvPass(NIGHT, NOW, ENV)!;
    expect(pass).toMatch(/^v1\.[0-9a-f-]{36}\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(pass.length).toBeLessThan(120);
    expect(verifyTvPass(pass, NOW, ENV)).toBe(NIGHT);
    expect(verifyTvPass(pass, NOW + 60_000, ENV)).toBe(NIGHT);
  });

  it("is good for 8 hours and not a minute more", () => {
    const pass = signTvPass(NIGHT, NOW, ENV)!;
    expect(DIAG_TV_PASS_TTL_MS).toBe(8 * 60 * 60_000);
    expect(verifyTvPass(pass, NOW + DIAG_TV_PASS_TTL_MS - 5_000, ENV)).toBe(NIGHT);
    expect(verifyTvPass(pass, NOW + DIAG_TV_PASS_TTL_MS + 5_000, ENV)).toBeNull();
    expect(verifyTvPass(pass, NOW + 24 * 60 * 60_000, ENV)).toBeNull();
  });

  it("cannot be moved to another night, given a longer life, or signed by someone without the secret", () => {
    const [v, , exp, sig] = signTvPass(NIGHT, NOW, ENV)!.split(".") as [string, string, string, string];
    expect(verifyTvPass([v, OTHER, exp, sig].join("."), NOW, ENV)).toBeNull();
    const longer = (parseInt(exp, 36) + 7 * 24 * 3600).toString(36);
    expect(verifyTvPass([v, NIGHT, longer, sig].join("."), NOW, ENV)).toBeNull();
    expect(verifyTvPass([v, NIGHT, exp, "A".repeat(43)].join("."), NOW, ENV)).toBeNull();
    const theirs = signTvPass(NIGHT, NOW, { SESSION_SECRET: "an-attacker-guess-0123456789" })!;
    expect(verifyTvPass(theirs, NOW, ENV)).toBeNull();
  });

  it("is not a device cookie and a device cookie is not a pass (the pass is signed with a key of its own)", () => {
    expect(verifyTvPass(`${NIGHT}.${"A".repeat(43)}`, NOW, ENV)).toBeNull();
    const [v, night, exp, sig] = signTvPass(NIGHT, NOW, ENV)!.split(".") as [string, string, string, string];
    // A device cookie is `${id}.${signature}`. Try every id a pass holder could build from what a pass
    // contains: none of them verifies, because the signing keys differ.
    const tries = [
      `${night}:${parseInt(exp, 36)}`,
      `${v}.${night}.${exp}`,
      `tr1via-diag-tv:v1:${night}:${parseInt(exp, 36)}`,
      `tr1via/diag-tv-pass/signing-key/v1`,
      night,
      `${night}:${exp}`,
    ];
    for (const id of tries) {
      expect(verifyDeviceCookie(`${id}.${sig}`, SECRET), id).toBeNull();
    }
    // and the other way round: a real device cookie's signature is no pass signature
    const cookie = signDeviceCookie(OTHER, SECRET); // `${OTHER}.${sig}`
    const cookieSig = cookie.slice(cookie.lastIndexOf(".") + 1);
    expect(verifyTvPass([v, OTHER, exp, cookieSig].join("."), NOW, ENV)).toBeNull();
    expect(verifyTvPass([v, NIGHT, exp, cookieSig].join("."), NOW, ENV)).toBeNull();
    // a pass signature really is not HMAC(secret, anything a pass holder can write down)
    expect(createHmac("sha256", SECRET).update(`${NIGHT}:${parseInt(exp, 36)}`).digest("base64url")).not.toBe(sig);
  });

  it("refuses junk without throwing", () => {
    for (const junk of [null, undefined, 5, {}, "", "v1", "v1...", "v2.a.b.c", "x".repeat(500), `v1.${NIGHT}.zz!.sig`, `v1.not-a-uuid.abc.sig`]) {
      expect(verifyTvPass(junk, NOW, ENV)).toBeNull();
    }
  });

  it("makes and accepts nothing when there is no server secret, or for something that is not a night id", () => {
    expect(signTvPass(NIGHT, NOW, {})).toBeNull();
    expect(signTvPass("not-a-night", NOW, ENV)).toBeNull();
    expect(verifyTvPass(signTvPass(NIGHT, NOW, ENV), NOW, {})).toBeNull();
  });
});

describe("issueTvPassForRoom: who is given a pass", () => {
  it("gives one for a real room while logging is on", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    const pass = await issueTvPassForRoom("K9PR4M");
    expect(verifyTvPass(pass)).toBe(NIGHT);
    expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("K9PR4M");
    // the way the code is shown on the screen works too
    await issueTvPassForRoom("K9P·R4M");
    expect(writeMock.lookupRoomNight).toHaveBeenLastCalledWith("K9PR4M");
  });

  it("gives none while logging is off, and does not even look the room up", async () => {
    for (const value of ["", "off"]) {
      vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      expect(await issueTvPassForRoom("K9PR4M")).toBeNull();
    }
    expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
  });

  it("gives none for a made-up code or a room that does not exist, and never throws", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    expect(await issueTvPassForRoom("nope!")).toBeNull();
    expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
    writeMock.lookupRoomNight.mockResolvedValue(null);
    expect(await issueTvPassForRoom("ZZZZZZ")).toBeNull();
    writeMock.lookupRoomNight.mockRejectedValue(new Error("database down"));
    expect(await issueTvPassForRoom("K9PR4M")).toBeNull();
  });
});

describe("issueTvPassForRoom: loading the TV page adds almost no database reads for junk codes", () => {
  beforeEach(() => vi.stubEnv("DIAGNOSTIC_LOGGING", "on"));
  const randomCode = (i: number) => `K${String(i).padStart(5, "7")}`.slice(0, 6);

  it("400 loads of never-seen codes at once reach the database only a handful of times", async () => {
    let answer: (v: string | null) => void = () => {};
    // every lookup stays pending, as in a slow database, so nothing is cached and nothing is released
    writeMock.lookupRoomNight.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const loads = Array.from({ length: 400 }, (_, i) => issueTvPassForRoom(randomCode(i)));
    await Promise.resolve();
    expect(writeMock.lookupRoomNight.mock.calls.length).toBeLessThanOrEqual(3); // at most 3 at once
    answer(null);
    const results = await Promise.race([Promise.all(loads), new Promise<null[]>((r) => setTimeout(() => r([]), 50))]);
    expect(results.length === 0 || results.every((r) => r === null)).toBe(true);
  });

  it("one after another, a flood of fresh codes is cut off after a small burst (and refills only slowly)", async () => {
    writeMock.lookupRoomNight.mockResolvedValue(null);
    for (let i = 0; i < 400; i++) await issueTvPassForRoom(randomCode(i));
    expect(writeMock.lookupRoomNight.mock.calls.length).toBe(10);
  });

  it("a code the log already knows costs no database read at all, found or not", async () => {
    writeMock.peekRoomNight.mockReturnValue(NIGHT);
    for (let i = 0; i < 50; i++) expect(verifyTvPass(await issueTvPassForRoom("K9PR4M"))).toBe(NIGHT);
    writeMock.peekRoomNight.mockReturnValue(null);
    for (let i = 0; i < 50; i++) expect(await issueTvPassForRoom("ZZZZZZ")).toBeNull();
    expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
  });

  it("a malformed code costs nothing", async () => {
    for (const bad of ["", "abc", "K9PR4M-extra", "<script>", "K9PR4"]) expect(await issueTvPassForRoom(bad)).toBeNull();
    expect(writeMock.peekRoomNight).not.toHaveBeenCalled();
    expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
  });

  it("while logging is paused (the database is in trouble) an unknown code is not looked up", async () => {
    writeMock.isLoggingPaused.mockReturnValue(true);
    expect(await issueTvPassForRoom("K9PR4M")).toBeNull();
    expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
  });
});

describe("the TV page hands its pass to the reporter", () => {
  it("DiagTvPassSetter sets the pass for the page's life and clears it on leaving", () => {
    expect(getDiagTvPass()).toBeNull();
    const { unmount } = render(<DiagTvPassSetter pass="v1.pass-for-the-test-page" />);
    expect(getDiagTvPass()).toBe("v1.pass-for-the-test-page");
    unmount();
    expect(getDiagTvPass()).toBeNull();
  });

  it("DiagTvPass (server) renders the setter with a pass for a real room, and nothing otherwise", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    const element = (await DiagTvPass({ params: Promise.resolve({ code: "K9PR4M" }) })) as ReactElement<{ pass: string }>;
    expect(element.type).toBe(DiagTvPassSetter);
    expect(verifyTvPass(element.props.pass)).toBe(NIGHT);

    writeMock.lookupRoomNight.mockResolvedValue(null);
    expect(await DiagTvPass({ params: Promise.resolve({ code: "ZZZZZZ" }) })).toBeNull();
    expect(await DiagTvPass({ params: Promise.reject(new Error("no params")) })).toBeNull();
  });
});

describe("the TV layout", () => {
  function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
    if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
    else if (isValidElement(node)) {
      out.push(node);
      flatten((node.props as { children?: ReactNode }).children, out);
    }
    return out;
  }
  const params = Promise.resolve({ code: "K9PR4M" });

  it("adds nothing for the pass while logging is off (the TV page is exactly as before)", () => {
    for (const value of ["", "off"]) {
      vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      const tree = flatten(TVLayout({ children: <span id="kid" />, params }));
      expect(tree.some((el) => el.type === DiagTvPass)).toBe(false);
      expect(tree.some((el) => (el.props as { id?: string }).id === "kid")).toBe(true);
    }
  });

  it("asks for the pass, inside a Suspense so the TV never waits on it, while logging is on", () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    const tree = flatten(TVLayout({ children: <span id="kid" />, params }));
    const pass = tree.find((el) => el.type === DiagTvPass);
    expect(pass).toBeDefined();
    const suspense = tree.find((el) => el.type === Suspense);
    expect(suspense).toBeDefined();
    expect(flatten((suspense!.props as { children?: ReactNode }).children)).toContain(pass);
    expect(tree.some((el) => (el.props as { id?: string }).id === "kid")).toBe(true);
  });
});
