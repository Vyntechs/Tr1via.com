// Safety net for theme decoration.
//
// Everything a monthly theme draws (weather, lock-in ceremonies, fireworks,
// a world behind the TV) is decoration on top of the game. Before this
// boundary there was no crash guard anywhere in the app, so one bad frame in
// a theme effect could unmount the whole venue TV or a player's phone.
//
// Wrap a decorative layer in <ThemeLayerBoundary name="..."> and, if it
// throws while rendering or in an effect, it switches itself off (renders
// `fallback`, null by default) and the game around it keeps going. It adds
// no DOM of its own, so a healthy layer looks exactly the same.
//
// Not covered: errors thrown inside requestAnimationFrame/setTimeout
// callbacks never reach React. Animation loops guard their own ticks.

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
