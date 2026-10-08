// GET /api/cron/diag-cleanup — the daily 45-day cleanup.
// It needs the cron secret and runs whenever the secret is set, whether or not
// logging is on (turning logging off must not leave old rows behind); the day
// count is never taken from the request.

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
    writeMock.runDiagCleanup.mockResolvedValue({ ok: true, removed: 3, batches: 2, more: false });
  });

  it("refuses a missing, wrong or empty secret and cleans nothing, whatever the logging switch says", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const value of ["on", "off", ""]) {
      vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      expect((await call()).status).toBe(401);
      expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
      expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
      expect((await call({ authorization: "Bearer s3cret-valuf" })).status).toBe(401);
    }
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
  });

  it("with no CRON_SECRET set (the state right after merging) refuses everyone, even 'Bearer undefined'", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "off");
    vi.stubEnv("CRON_SECRET", "");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
  });

  it("runs with the right secret even while logging is OFF, so old rows are still removed after it is switched off", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const value of [undefined, "", "off", "1", "true", "on"]) {
      if (value === undefined) vi.stubEnv("DIAGNOSTIC_LOGGING", "");
      else vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      const res = await call({ authorization: "Bearer s3cret-value" });
      expect(res.status, String(value)).toBe(200);
    }
    expect(writeMock.runDiagCleanup).toHaveBeenCalledTimes(6);
  });

  it("with the right secret, runs the fixed 45-day cleanup once and reports how it went", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    // A day count in the request is ignored: the function takes no arguments.
    const res = await call({ authorization: "Bearer s3cret-value" }, "http://test/api/cron/diag-cleanup?days=0");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, days: 45, removed: 3, batches: 2, more: false });
    expect(writeMock.runDiagCleanup).toHaveBeenCalledTimes(1);
    expect(writeMock.runDiagCleanup).toHaveBeenCalledWith();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("says when there was more left than one run could remove (the next day carries on)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    writeMock.runDiagCleanup.mockResolvedValue({ ok: true, removed: 400_000, batches: 20, more: true });
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: 400_000, more: true });
  });

  it("answers 500 with a short code (and what it already removed) when the cleanup fails, e.g. the migration is not applied", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    writeMock.runDiagCleanup.mockResolvedValue({ ok: false, code: "42883", removed: 0, batches: 0 });
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "42883", removed: 0 });
  });
});

describe("vercel.json", () => {
  it("schedules exactly one daily call to the cleanup route and nothing else", () => {
    const config = JSON.parse(readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"));
    expect(Object.keys(config)).toEqual(["crons"]);
    expect(config.crons).toEqual([{ path: "/api/cron/diag-cleanup", schedule: "17 9 * * *" }]);
  });
});
