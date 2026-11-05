import { describe, expect, it, vi } from "vitest";
import {
  CLOSE_CALLER_HEADER,
  closeCallerFrom,
  closeLateMs,
  logClose,
  logLateRefusal,
} from "@/lib/live/logClose";

function requestWith(caller?: string) {
  return new Request("http://test/", {
    method: "POST",
    headers: caller ? { [CLOSE_CALLER_HEADER]: caller } : {},
  });
}

describe("logClose", () => {
  it("writes one JSON line with the agreed fields", () => {
    const sink = vi.fn();

    logClose(
      { questionId: "q1", roomCode: "ABCDEF", closedBy: "phone", lateMs: 120 },
      sink,
    );

    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sink.mock.calls[0][0] as string)).toEqual({
      kind: "close",
      questionId: "q1",
      roomCode: "ABCDEF",
      closedBy: "phone",
      lateMs: 120,
    });
  });

  it("never throws out of a committed close", () => {
    expect(() =>
      logClose(
        { questionId: "q1", roomCode: "ABCDEF", closedBy: "tv", lateMs: null },
        () => {
          throw new Error("log sink down");
        },
      ),
    ).not.toThrow();
  });

  it("writes the late-refusal line and survives a broken sink", () => {
    const sink = vi.fn();

    logLateRefusal({ questionId: "q1", lateMs: 40 }, sink);

    expect(JSON.parse(sink.mock.calls[0][0] as string)).toEqual({
      kind: "late_refusal",
      questionId: "q1",
      lateMs: 40,
    });
    expect(() =>
      logLateRefusal({ questionId: "q1", lateMs: null }, () => {
        throw new Error("log sink down");
      }),
    ).not.toThrow();
  });

  it("accepts only the known timer callers from the header", () => {
    expect(closeCallerFrom(requestWith("phone"))).toBe("phone");
    expect(closeCallerFrom(requestWith("tv"))).toBe("tv");
    expect(closeCallerFrom(requestWith("host"))).toBe("unknown");
    expect(closeCallerFrom(requestWith())).toBe("unknown");
  });

  it("reports late as positive, early as negative and missing as null", () => {
    expect(closeLateMs(1_500, 1_000)).toBe(500);
    expect(closeLateMs(500, 1_000)).toBe(-500);
    expect(closeLateMs(500, null)).toBeNull();
    expect(closeLateMs(500, Number.NaN)).toBeNull();
  });
});
