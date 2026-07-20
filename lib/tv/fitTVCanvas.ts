export const TV_LOGICAL_WIDTH = 1_600;
export const TV_LOGICAL_HEIGHT = 900;

export interface TVCanvasFit {
  scale: number;
  width: number;
  height: number;
}

/** Contain-fit one immutable 16:9 composition inside any viewport. */
export function fitTVCanvas(
  viewportWidth: number,
  viewportHeight: number,
): TVCanvasFit {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const scale = Math.min(
    width / TV_LOGICAL_WIDTH,
    height / TV_LOGICAL_HEIGHT,
  );

  return {
    scale,
    width: TV_LOGICAL_WIDTH * scale,
    height: TV_LOGICAL_HEIGHT * scale,
  };
}
