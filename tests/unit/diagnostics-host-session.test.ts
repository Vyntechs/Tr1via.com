// The host laptop's report is checked after the reply has gone out. That check
// must be STRICTLY READ-ONLY: if it renewed the host's session it would use up
// her refresh token, the new one could not reach her browser, and her browser's
// own renewal could be refused (signing her out mid-show).

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supa = vi.hoisted(() => ({
  createClient: vi.fn(),
  auth: {
    getUser: vi.fn(),
    // Everything that could renew or change a session. None may ever be called.
    refreshSession: vi.fn(),
    setSession: vi.fn(),
    getSession: vi.fn(),
    signOut: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    verifyOtp: vi.fn(),
    signInWithPassword: vi.fn(),
    updateUser: vi.fn(),
  },
  hostRow: vi.fn(),
  fromTables: [] as string[],
}));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient: supa.createClient }));
vi.mock("@/lib/supabase/admin", () => adminMock);

import {
  __resetHostSessionForTests,
  accessTokenFromCookies,
  sessionCookiesOf,
  verifyHostSessionReadOnly,
} from "@/lib/diagnostics/hostSession";
import { DiagLookupSlow } from "@/lib/diagnostics/deadline";
import { DIAG_WRITE_TIMEOUT_MS } from "@/lib/diagnostics/config";

const NOW = Date.parse("2026-10-07T23:00:00Z"); // for the pure functions, which take the time as an argument
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600; // for the ones that read the real clock
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload-part.signature-part";
const HOST_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "11111111-aaaa-4aaa-8aaa-111111111111";

const session = (token = TOKEN, expiresAt: number | undefined = Math.floor(NOW / 1000) + 3600) => ({
  access_token: token,
  refresh_token: "refresh-token-value",
  token_type: "bearer",
  expires_at: expiresAt,
  user: { id: USER_ID },
});
const base64Cookie = (obj: unknown) => "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
const goodCookies = (token = TOKEN, expiresAt: number | undefined = inAnHour()) => [
  { name: "sb-localproj-auth-token", value: base64Cookie(session(token, expiresAt)) },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  __resetHostSessionForTests();
  supa.fromTables.length = 0;
  supa.createClient.mockImplementation(() => ({ auth: supa.auth }));
  supa.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  supa.hostRow.mockResolvedValue({ data: { id: HOST_ID }, error: null });
  adminMock.getSupabaseAdmin.mockReturnValue({
    from: (table: string) => {
      supa.fromTables.push(table);
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => supa.hostRow() };
      return chain;
    },
  });
});

describe("reading the access token out of the sign-in cookie, exactly as it is", () => {
  it("reads the current cookie format (base64-prefixed), whole or split into chunks", () => {
    expect(accessTokenFromCookies(goodCookies(TOKEN, Math.floor(NOW / 1000) + 3600), NOW)).toBe(TOKEN);
    const value = base64Cookie(session());
    const half = Math.floor(value.length / 2);
    expect(
      accessTokenFromCookies(
        [
          { name: "sb-localproj-auth-token.1", value: value.slice(half) },
          { name: "sb-localproj-auth-token.0", value: value.slice(0, half) },
        ],
        NOW,
      ),
    ).toBe(TOKEN);
  });

  it("reads the older plain-JSON format too (also URL-encoded)", () => {
    const json = JSON.stringify(session());
    expect(accessTokenFromCookies([{ name: "sb-localproj-auth-token", value: json }], NOW)).toBe(TOKEN);
    expect(accessTokenFromCookies([{ name: "sb-localproj-auth-token", value: encodeURIComponent(json) }], NOW)).toBe(TOKEN);
  });

  it("finds nothing in anything else", () => {
    for (const cookies of [
      [],
      [{ name: "tr1via_device", value: "abc.def" }],
      [{ name: "sb-localproj-auth-token", value: "not json" }],
      [{ name: "sb-localproj-auth-token", value: base64Cookie({ nothing: "here" }) }],
      [{ name: "sb-localproj-auth-token", value: base64Cookie({ access_token: "" }) }],
      [{ name: "sb-localproj-auth-token.1", value: "orphan chunk without a first one" }],
      [{ name: "other-auth-token", value: base64Cookie(session()) }],
    ]) {
      expect(accessTokenFromCookies(cookies, NOW)).toBeNull();
    }
  });

  it("drops an access token that is expired, or about to be, on the spot", () => {
    expect(accessTokenFromCookies(goodCookies(TOKEN, Math.floor(NOW / 1000) - 5), NOW)).toBeNull();
    expect(accessTokenFromCookies(goodCookies(TOKEN, Math.floor(NOW / 1000) + 5), NOW)).toBeNull(); // under 10 s left
    expect(accessTokenFromCookies(goodCookies(TOKEN, Math.floor(NOW / 1000) + 60), NOW)).toBe(TOKEN);
  });

  it("sessionCookiesOf keeps only the sign-in cookies", () => {
    const all = [
      { name: "sb-localproj-auth-token", value: "a" },
      { name: "sb-localproj-auth-token.0", value: "b" },
      { name: "tr1via_device", value: "c" },
      { name: "theme", value: "d" },
    ];
    expect(sessionCookiesOf(all).map((c) => c.name)).toEqual(["sb-localproj-auth-token", "sb-localproj-auth-token.0"]);
  });
});

describe("verifyHostSessionReadOnly", () => {
  it("asks the sign-in service who the token belongs to, with that token and nothing else, and finds the host", async () => {
    await expect(verifyHostSessionReadOnly(goodCookies())).resolves.toBe(HOST_ID);
    // a client that cannot renew a session, store one or write a cookie
    expect(supa.createClient).toHaveBeenCalledTimes(1);
    expect(supa.createClient.mock.calls[0]![2]).toEqual({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    // getUser(jwt): the token is passed in, so the library does not load or renew any session
    expect(supa.auth.getUser).toHaveBeenCalledTimes(1);
    expect(supa.auth.getUser).toHaveBeenCalledWith(TOKEN);
    expect(supa.fromTables).toEqual(["hosts"]);
  });

  it("never renews, sets, reads, replaces or ends a session, whatever the outcome", async () => {
    const outcomes: Array<() => void> = [
      () => supa.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      () => supa.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } }),
      () => supa.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 403, name: "AuthApiError" } }),
      () => supa.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } }),
      () => supa.auth.getUser.mockRejectedValue(new Error("socket hang up")),
    ];
    for (const arrange of outcomes) {
      arrange();
      await verifyHostSessionReadOnly(goodCookies()).catch(() => {});
    }
    // also with a token that is already expired
    await verifyHostSessionReadOnly(goodCookies(TOKEN, Math.floor(NOW / 1000) - 600)).catch(() => {});
    for (const name of [
      "refreshSession",
      "setSession",
      "getSession",
      "signOut",
      "exchangeCodeForSession",
      "verifyOtp",
      "signInWithPassword",
      "updateUser",
    ] as const) {
      expect(supa.auth[name], name).not.toHaveBeenCalled();
    }
    // and the one call it makes is always the token-in form
    for (const call of supa.auth.getUser.mock.calls) expect(call).toEqual([TOKEN]);
  });

  it("an expired access token costs no network call at all: the report is just dropped", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const expired = goodCookies(TOKEN, Math.floor(Date.now() / 1000) - 3600);
      await expect(verifyHostSessionReadOnly(expired)).resolves.toBeNull();
      await expect(verifyHostSessionReadOnly([])).resolves.toBeNull();
      expect(supa.createClient).not.toHaveBeenCalled();
      expect(supa.auth.getUser).not.toHaveBeenCalled();
      expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a token the sign-in service does not accept is a plain no", async () => {
    supa.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } });
    await expect(verifyHostSessionReadOnly(goodCookies())).resolves.toBeNull();
    expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("a signed-in user who is not a host is a no", async () => {
    supa.hostRow.mockResolvedValue({ data: null, error: null });
    await expect(verifyHostSessionReadOnly(goodCookies())).resolves.toBeNull();
  });

  it("trouble reaching the sign-in service or the database is 'could not check', never 'not a host'", async () => {
    supa.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, name: "AuthApiError" } });
    await expect(verifyHostSessionReadOnly(goodCookies())).rejects.toBeInstanceOf(DiagLookupSlow);
    supa.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 0, name: "AuthRetryableFetchError" } });
    await expect(verifyHostSessionReadOnly(goodCookies())).rejects.toBeInstanceOf(DiagLookupSlow);
    supa.auth.getUser.mockRejectedValue(new Error("socket hang up"));
    await expect(verifyHostSessionReadOnly(goodCookies())).rejects.toBeInstanceOf(DiagLookupSlow);
    supa.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    supa.hostRow.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(verifyHostSessionReadOnly(goodCookies())).rejects.toBeInstanceOf(DiagLookupSlow);
  });

  it("stops waiting on a sign-in service that does not answer", async () => {
    vi.useFakeTimers();
    supa.auth.getUser.mockReturnValue(new Promise(() => {}));
    const result = verifyHostSessionReadOnly(goodCookies());
    const caught = result.catch((e) => e);
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS + 50);
    expect(await caught).toBeInstanceOf(DiagLookupSlow);
  });
});

describe("the host check can never be made to renew a session or write a cookie (guard on the source)", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  // comments may explain what is NOT done; only code counts
  const code = (file: string) =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it.each(["lib/diagnostics/hostSession.ts", "app/api/diag/report/route.ts"])(
    "%s does not import the cookie-writing sign-in helpers",
    (file) => {
      const source = code(file);
      for (const forbidden of [
        "next/headers",
        "@supabase/ssr",
        "getSupabaseServer",
        "getAuthedHost",
        "createSessionCookieClient",
        "lib/supabase/server",
        "refreshSession",
        "setSession",
        "exchangeCodeForSession",
        "signOut",
        "cookies()",
      ]) {
        expect(source, `${file} mentions ${forbidden}`).not.toContain(forbidden);
      }
      // nothing that writes a cookie to a request or a response
      expect(source, file).not.toMatch(/cookieStore|setAll|Set-Cookie|\.cookies\.(set|delete)|NextResponse|response\.headers\.(set|append)/i);
    },
  );

  it("the only sign-in call in hostSession.ts is getUser with the token passed in", () => {
    const source = code("lib/diagnostics/hostSession.ts");
    const calls = [...source.matchAll(/\.auth\.(\w+)\(/g)].map((m) => m[1]);
    expect(calls).toEqual(["getUser"]);
    expect(source).toMatch(/auth\.getUser\(accessToken\)/);
    expect(source).toContain("autoRefreshToken: false");
    expect(source).toContain("persistSession: false");
  });
});
