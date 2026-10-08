// GET /api/cron/diag-cleanup — the daily 45-day cleanup.
// With logging off it must do nothing at all; with logging on it needs the
// cron secret; the day count is never taken from the request.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeMock = vi.hoisted(() => ({ runDiagCleanup: vi.fn() }));
vi.mock("@/lib/diagnostics/write", () => writeMock);

import { GET } from "@/app/api/cron/diag-cleanup/route";

function call(headers: Record<string, string> = {}, url = "http://test/api/cron/diag-cleanup") {
  return GET(new Request(url, { headers }));
}

describe("GET /api/cron/diag-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    writeMock.runDiagCleanup.mockResolvedValue({ ok: true, removed: 3 });
  });

  it("does nothing at all while logging is off or unset, even with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const value of [undefined, "", "off", "1", "true"]) {
      if (value === undefined) vi.stubEnv("DIAGNOSTIC_LOGGING", "");
      else vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      const res = await call({ authorization: "Bearer s3cret-value" });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
  });

  it("does nothing while logging is off and no secret is set either (the state right after merging)", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "off");
    vi.stubEnv("CRON_SECRET", "");
    expect((await call()).status).toBe(204);
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
  });

  it("with logging on, refuses a missing, wrong or empty secret and cleans nothing", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-valuf" })).status).toBe(401);
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
  });

  it("with logging on but no CRON_SECRET set, refuses everyone (even 'Bearer undefined')", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
  });

  it("with logging on and the right secret, runs the fixed 45-day cleanup once", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    // A day count in the request is ignored: the function takes no arguments.
    const res = await call({ authorization: "Bearer s3cret-value" }, "http://test/api/cron/diag-cleanup?days=0");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, days: 45, removed: 3 });
    expect(writeMock.runDiagCleanup).toHaveBeenCalledTimes(1);
    expect(writeMock.runDiagCleanup).toHaveBeenCalledWith();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 500 with a short code when the cleanup fails", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    writeMock.runDiagCleanup.mockResolvedValue({ ok: false, code: "42883" });
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "42883" });
  });
});

describe("vercel.json", () => {
  it("schedules exactly one daily call to the cleanup route and nothing else", () => {
    const config = JSON.parse(readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"));
    expect(Object.keys(config)).toEqual(["crons"]);
    expect(config.crons).toEqual([{ path: "/api/cron/diag-cleanup", schedule: "17 9 * * *" }]);
  });
});
