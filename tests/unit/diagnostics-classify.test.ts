// Fixed-vocabulary labels for the diagnostic log, and the tap-time headers.

import { describe, expect, it } from "vitest";
import {
  broadcastErrorKind,
  classifyActionResponse,
  classifyAnswerResponse,
  readBodyHint,
} from "@/lib/diagnostics/classify";
import { parseTapHeaders } from "@/lib/diagnostics/serverLog";

describe("classifyAnswerResponse", () => {
  it("names every way the legacy route answers", () => {
    const c = classifyAnswerResponse;
    expect(c(204, null)).toEqual({ outcome: "saved", reason: "saved" });
    expect(c(400, { error: "answer deadline passed" })).toEqual({ outcome: "late", reason: "deadline_passed" });
    expect(c(400, { error: "answer deadline passed" }, true)).toEqual({ outcome: "late", reason: "deadline_passed_at_save" });
    expect(c(400, { error: "question is closed" })).toEqual({ outcome: "late", reason: "question_closed" });
    expect(c(409, { error: "question is not live" })).toEqual({ outcome: "early", reason: "question_not_live" });
    expect(c(409, { error: "already answered" })).toEqual({ outcome: "duplicate", reason: "already_answered" });
    expect(c(403, { error: "not joined to this night" })).toEqual({ outcome: "rejected", reason: "not_joined" });
    expect(c(403, { error: "scramble mismatch" })).toEqual({ outcome: "rejected", reason: "scramble_mismatch" });
    expect(c(401, { error: "no device session" })).toEqual({ outcome: "rejected", reason: "no_device_session" });
    expect(c(500, { error: "server error" })).toEqual({ outcome: "error", reason: "server_error" });
  });

  it("reads the resilient engine's result codes", () => {
    const c = classifyAnswerResponse;
    expect(c(200, { code: "confirmed", duplicate: false })).toEqual({ outcome: "saved", reason: "saved" });
    expect(c(200, { code: "confirmed", duplicate: true })).toEqual({ outcome: "duplicate", reason: "already_answered" });
    expect(c(200, { code: "deadline_passed" })).toEqual({ outcome: "late", reason: "deadline_passed" });
    expect(c(200, { code: "retry_later" })).toEqual({ outcome: "error", reason: "retry_later" });
  });

  it("never stores unknown text: it becomes a status label", () => {
    expect(classifyAnswerResponse(418, { error: "I am a teapot, here is a phone number 555-1234" })).toEqual({
      outcome: "rejected",
      reason: "other_418",
    });
    expect(classifyAnswerResponse(400, { error: "free-form zod text" })).toEqual({
      outcome: "rejected",
      reason: "invalid_request",
    });
  });
});

describe("classifyActionResponse", () => {
  it("labels the host and timer outcomes", () => {
    const c = classifyActionResponse;
    expect(c(200, { revealedAt: "x" })).toEqual({ outcome: "ok", reason: "ok" });
    expect(c(200, { alreadyResolved: true })).toEqual({ outcome: "already_resolved", reason: "ok" });
    expect(c(200, { resolvedAt: "x", awardCount: 12 })).toEqual({ outcome: "resolved", reason: "ok" });
    expect(c(200, { state: "standings-board", repeated: true })).toEqual({ outcome: "repeat", reason: "ok" });
    expect(c(200, { result: { code: "resolved" } })).toEqual({ outcome: "resolved", reason: "ok" });
    expect(c(409, { error: "question answer window is still open" })).toEqual({ outcome: "conflict", reason: "too_early" });
    expect(c(409, { error: "undo window expired (1234ms)" })).toEqual({ outcome: "conflict", reason: "undo_window_expired" });
    expect(c(401, { error: "not signed in" })).toEqual({ outcome: "denied", reason: "not_signed_in" });
    expect(c(409, { error: "something new" })).toEqual({ outcome: "conflict", reason: "other" });
    expect(c(500, { error: "db password is hunter2" })).toEqual({ outcome: "error", reason: "server_error" });
  });
});

describe("readBodyHint", () => {
  it("reads small JSON and never throws", async () => {
    expect(await readBodyHint(new Response('{"error":"x"}'))).toEqual({ error: "x" });
    expect(await readBodyHint(new Response("not json"))).toBeNull();
    expect(await readBodyHint(new Response("[1,2]"))).toEqual([1, 2]);
    expect(await readBodyHint(null)).toBeNull();
    const used = new Response("{}");
    await used.text();
    expect(await readBodyHint(used)).toBeNull(); // body already used
  });
});

describe("broadcastErrorKind", () => {
  it("gives a short label, not the message", () => {
    expect(broadcastErrorKind(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("timeout");
    expect(broadcastErrorKind(new Error("broadcast HTTP 503: upstream"))).toBe("http_5xx");
    expect(broadcastErrorKind(new Error("broadcast HTTP 401: nope"))).toBe("http_4xx");
    expect(broadcastErrorKind(new TypeError("fetch failed"))).toBe("network");
    expect(broadcastErrorKind("weird")).toBe("network");
  });
});

describe("parseTapHeaders", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("reads the phone's tap, send time and attempt", () => {
    expect(
      parseTapHeaders(h({ "x-tr1via-tap-at": "1784422809000", "x-tr1via-sent-at": "1784422809400", "x-tr1via-attempt": "3" })),
    ).toEqual({
      tapAt: new Date(1784422809000).toISOString(),
      sentAt: new Date(1784422809400).toISOString(),
      attempt: 3,
    });
  });

  it("ignores junk instead of failing", () => {
    expect(parseTapHeaders(h({}))).toEqual({ tapAt: null, sentAt: null, attempt: null });
    expect(parseTapHeaders(h({ "x-tr1via-tap-at": "abc", "x-tr1via-sent-at": "12", "x-tr1via-attempt": "-1" }))).toEqual({
      tapAt: null,
      sentAt: null,
      attempt: null,
    });
    expect(parseTapHeaders(h({ "x-tr1via-tap-at": "99999999999999" })).tapAt).toBeNull(); // year 5138
  });
});
