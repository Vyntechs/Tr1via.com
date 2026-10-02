// Safety net for theme decoration.
//
// Everything a monthly theme draws (weather, lock-in ceremonies, fireworks,
// a world behind the TV) is decoration on top of the game. Before this
// boundary there was no crash guard anywhere in the app, so one bad frame in
// a theme effect could unmount the whole venue TV or a player's phone.
//
// Wrap a decorative layer in <ThemeLayerBoundary name="..."> and, if it
// throws while rendering or in an effect while it is on screen, it switches
// itself off (renders `fallback`, null by default) and the game around it
// keeps going. It adds no DOM of its own, so a healthy layer looks exactly
// the same. Change `resetKey` (e.g. the theme) to give a failed layer a
// fresh try without rebuilding the guard.
//
// Not covered:
// - Errors thrown inside requestAnimationFrame/setTimeout callbacks never
//   reach React. They can't blank the page, but a loop that throws mid-frame
//   just stops, so new animation loops catch their own errors.
// - An effect CLEANUP that throws while the layer is being removed together
//   with its guard (e.g. when the TV changes screens). Keep theme cleanups
//   trivial (cancel a frame, clear a timer, unsubscribe).
// The theme "beat" signals go through guardThemeCall so one broken listener
// can't break the game screen that fired it.

"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ThemeLayerBoundaryProps {
  /** Short label for the log line, e.g. "weather:may". */
  name: string;
  children: ReactNode;
  /** Rendered instead of the layer once it has failed. Default: nothing. */
  fallback?: ReactNode;
  /** Told once, when the layer switches itself off. */
  onFail?: (error: unknown) => void;
  /** When this changes, a failed layer gets a fresh try. */
  resetKey?: string | number | null;
}

const warnedCalls = new Set<string>();

/** Run one theme listener; if it throws, skip it (logging once per name). Used
 *  by the theme "beat" signals (June sky, May lightning, July fireworks),
 *  which game screens fire from their own effects. */
export function guardThemeCall(name: string, call: () => void): void {
  try {
    call();
  } catch (error) {
    if (warnedCalls.has(name)) return;
    warnedCalls.add(name);
    console.warn(`[theme] a "${name}" listener failed and was skipped; the game keeps going.`, error);
  }
}

interface ThemeLayerBoundaryState {
  failed: boolean;
}

export class ThemeLayerBoundary extends Component<
  ThemeLayerBoundaryProps,
  ThemeLayerBoundaryState
> {
  state: ThemeLayerBoundaryState = { failed: false };

  static getDerivedStateFromError(): ThemeLayerBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(prev: ThemeLayerBoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(
      `[theme] "${this.props.name}" switched off after an error; the game keeps going.`,
      error,
      info.componentStack,
    );
    try {
      this.props.onFail?.(error);
    } catch {
      /* the guard must never throw */
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
