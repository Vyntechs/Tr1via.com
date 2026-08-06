// A screen that cannot scroll must fit. Not "usually fit" — fit.
//
// The venue TV already solves this: `fitTVCanvas` lays a television out on one
// immutable 1600×900 stage and scales the finished stage into whatever
// rectangle it is given. Nothing reflows, nothing is cropped, and it is
// correct on every display without a single breakpoint.
//
// A phone needs the same guarantee and one different assumption. A television
// is always 16:9; phones are not — 320×568, 360×560, 393×873 are all real, and
// contain-fitting a fixed canvas into that spread would letterbox badly. So we
// fix only the HEIGHT and let the width follow the device:
//
//   layout at (viewportWidth / scale) × LOGICAL_HEIGHT, then scale by
//   scale = min(1, viewportHeight / LOGICAL_HEIGHT)
//
// which renders back at exactly viewportWidth × viewportHeight. Full bleed,
// no letterbox, no crop, no reflow — and every control keeps its place in the
// composition no matter how short the phone is.
//
// Capped at 1 so a tall phone is never magnified; there the layout simply has
// room to spare, which is what the flexible question box is for.
//
// Why this and not a pile of breakpoints: the failure it replaces was a small
// Android where the four answer cards ran off the bottom of a screen that
// deliberately cannot scroll, so they were untappable and the player could not
// answer at all. Clamping card heights and hiding footnotes moved that cliff
// around instead of removing it. Scaling removes it: there is no viewport
// short enough to push a control off a stage that is fitted to the viewport.

/** The height every scroll-locked phone screen is composed against. Chosen as
 *  a comfortable phone stage: taller than the shortest device in circulation,
 *  so real phones scale down slightly rather than up. */
export const PHONE_LOGICAL_HEIGHT = 640;

export interface PhoneStageFit {
  /** Uniform transform scale to apply to the stage. Never above 1. */
  scale: number;
  /** CSS width to lay the stage out at, so it renders back at viewportWidth. */
  width: number;
  /** CSS height to lay the stage out at. Always PHONE_LOGICAL_HEIGHT once fitted. */
  height: number;
}

/**
 * Fit one phone stage into the given viewport.
 *
 * Returns the layout box to compose in and the scale to render it at. A
 * degenerate viewport (zero, negative, NaN — a first paint before measurement)
 * returns scale 1 and the logical box, so the screen renders sensibly rather
 * than collapsing to nothing.
 */
export function fitPhoneStage(
  viewportWidth: number,
  viewportHeight: number,
): PhoneStageFit {
  const w = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
  const h = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;

  if (w === 0 || h === 0) {
    return { scale: 1, width: w || PHONE_LOGICAL_HEIGHT, height: PHONE_LOGICAL_HEIGHT };
  }

  // Only ever shrink. A phone taller than the stage keeps 1:1 typography and
  // lets its own flexible regions absorb the extra room.
  const scale = Math.min(1, h / PHONE_LOGICAL_HEIGHT);

  return {
    scale,
    // Divide, so that after scaling the stage spans the full device width.
    width: w / scale,
    // At scale 1 the stage is taller than the logical height by exactly the
    // spare room; below 1 it is the logical height on the nose.
    height: h / scale,
  };
}
