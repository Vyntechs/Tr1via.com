import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  safeSurfaceEvidenceRelease,
  SURFACE_EVIDENCE_TAB_KEY,
  SURFACE_EVIDENCE_TIMEOUT_MS,
  useSurfaceEvidence,
  type SurfaceEvidenceFrame,
} from "@/lib/hooks/useSurfaceEvidence";

const ENDPOINT = "/api/host/nights/night-1/surface-receipts";
const TAB_ID = "11111111-1111-4111-8111-111111111111";

let visibility: DocumentVisibilityState;
let nextRafId: number;
let rafCallbacks: Map<number, FrameRequestCallback>;

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function flushAnimationFrame() {
  const callbacks = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  act(() => {
    for (const [, callback] of callbacks) callback(performance.now());
  });
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function frame(frameKind: SurfaceEvidenceFrame["frameKind"]): SurfaceEvidenceFrame {
  return { questionId: "question-1", frameKind };
}

function options(currentFrame: SurfaceEvidenceFrame | null) {
  return {
    endpoint: ENDPOINT,
    frame: currentFrame,
    clientRelease: "dpl_safe-release.1",
  };
}

describe("useSurfaceEvidence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    nextRafId = 1;
    rafCallbacks = new Map();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      rafCallbacks.delete(id);
    }));
    window.sessionStorage.clear();
    window.sessionStorage.setItem(SURFACE_EVIDENCE_TAB_KEY, TAB_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("waits for a visible document and two animation frames before sending", async () => {
    visibility = "hidden";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSurfaceEvidence(options(frame("question_open"))));
    flushAnimationFrame();
    flushAnimationFrame();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    flushAnimationFrame();
    expect(fetchMock).not.toHaveBeenCalled();
    flushAnimationFrame();
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
    });
    expect(JSON.parse(String(init.body))).toEqual({
      questionId: "question-1",
      frameKind: "question_open",
      surfaceInstanceId: TAB_ID,
      clientRelease: "dpl_safe-release.1",
    });
  });

  it("deduplicates an unchanged frame under StrictMode and rerenders", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const stableFrame = frame("question_open");
    const { rerender } = renderHook(
      ({ currentFrame }) => useSurfaceEvidence(options(currentFrame)),
      {
        initialProps: { currentFrame: stableFrame },
        wrapper: StrictMode,
      },
    );

    flushAnimationFrame();
    flushAnimationFrame();
    await flushAsync();
    rerender({ currentFrame: { ...stableFrame } });
    flushAnimationFrame();
    flushAnimationFrame();
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never has more than one request in flight and sends the queued next frame", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderHook(
      ({ currentFrame }) => useSurfaceEvidence(options(currentFrame)),
      { initialProps: { currentFrame: frame("question_open") } },
    );

    flushAnimationFrame();
    flushAnimationFrame();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ currentFrame: frame("timer_zero") });
    flushAnimationFrame();
    flushAnimationFrame();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(new Response(null, { status: 204 }));
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(secondInit.body)).frameKind).toBe("timer_zero");
  });

  it("retries a timeout once while the same visible frame remains, then stops", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderHook(() => useSurfaceEvidence(options(frame("answer_reveal"))));

    flushAnimationFrame();
    flushAnimationFrame();
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SURFACE_EVIDENCE_TIMEOUT_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SURFACE_EVIDENCE_TIMEOUT_MS * 2);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry once the browser has moved to another frame", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderHook(
      ({ currentFrame }) => useSurfaceEvidence(options(currentFrame)),
      { initialProps: { currentFrame: frame("question_open") } },
    );

    flushAnimationFrame();
    flushAnimationFrame();
    rerender({ currentFrame: frame("timer_zero") });
    await flushAsync();

    // One failed request for the old frame; the newly committed frame queues
    // only after its own two-paint proof below.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    flushAnimationFrame();
    flushAnimationFrame();
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(3); // new frame + its one retry
  });

  it("swallows terminal failures and sends a sanitized release value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() =>
      useSurfaceEvidence({
        endpoint: ENDPOINT,
        frame: frame("question_open"),
        clientRelease: "<script>unsafe</script>",
      }),
    );

    flushAnimationFrame();
    flushAnimationFrame();
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).clientRelease).toBe("unknown");
    expect(safeSurfaceEvidenceRelease(" sha.123 ")).toBe("sha.123");
  });

  it("aborts on unmount without surfacing an error or retrying", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() =>
      useSurfaceEvidence(options(frame("question_open"))),
    );

    flushAnimationFrame();
    flushAnimationFrame();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    await flushAsync();

    expect(signals[0]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
