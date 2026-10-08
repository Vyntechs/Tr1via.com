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
    vi.stubEnv("CRON_SECRET", "s3cret-value-long-enough");
    for (const value of ["on", "off", ""]) {
      vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      expect((await call()).status).toBe(401);
      expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
      expect((await call({ authorization: "s3cret-value-long-enough" })).status).toBe(401);
      expect((await call({ authorization: "Bearer s3cret-value-long-enougf" })).status).toBe(401);
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

  it("refuses a secret shorter than 16 characters LOUDLY (a log line and a clear 500, no secret in either), even when the caller sends exactly that secret", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const short of ["s3cret-value", "0123456789abcde"]) {
      vi.stubEnv("CRON_SECRET", short);
      const res = await call({ authorization: `Bearer ${short}` });
      expect(res.status, short).toBe(500);
      const text = await res.text();
      expect(text).toContain("shorter than 16 characters");
      expect(text).not.toContain(short);
    }
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(String(errorLog.mock.calls[0]![0])).toContain("CRON_SECRET");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("s3cret-value");
    errorLog.mockRestore();
    expect(writeMock.runDiagCleanup).not.toHaveBeenCalled();
    // Exactly 16 characters is the shortest that works.
    vi.stubEnv("CRON_SECRET", "0123456789abcdef");
    expect((await call({ authorization: "Bearer 0123456789abcdef" })).status).toBe(200);
  });

  it("runs with the right secret even while logging is OFF, so old rows are still removed after it is switched off", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-long-enough");
    for (const value of [undefined, "", "off", "1", "true", "on"]) {
      if (value === undefined) vi.stubEnv("DIAGNOSTIC_LOGGING", "");
      else vi.stubEnv("DIAGNOSTIC_LOGGING", value);
      const res = await call({ authorization: "Bearer s3cret-value-long-enough" });
      expect(res.status, String(value)).toBe(200);
    }
    expect(writeMock.runDiagCleanup).toHaveBeenCalledTimes(6);
  });

  it("with the right secret, runs the fixed 45-day cleanup once and reports how it went", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-long-enough");
    // A day count in the request is ignored: the function takes no arguments.
    const res = await call({ authorization: "Bearer s3cret-value-long-enough" }, "http://test/api/cron/diag-cleanup?days=0");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, days: 45, removed: 3, batches: 2, more: false });
    expect(writeMock.runDiagCleanup).toHaveBeenCalledTimes(1);
    expect(writeMock.runDiagCleanup).toHaveBeenCalledWith();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("says when there was more left than one run could remove (the next day carries on)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-long-enough");
    writeMock.runDiagCleanup.mockResolvedValue({ ok: true, removed: 400_000, batches: 20, more: true });
    const res = await call({ authorization: "Bearer s3cret-value-long-enough" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: 400_000, more: true });
  });

  it("answers 500 with a short code (and what it already removed) when the cleanup fails, e.g. the migration is not applied", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-long-enough");
    writeMock.runDiagCleanup.mockResolvedValue({ ok: false, code: "42883", removed: 0, batches: 0 });
    const res = await call({ authorization: "Bearer s3cret-value-long-enough" });
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
