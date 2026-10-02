// October · the flaming head the leader holds (original art from the Figma
// kit). Its own small file so a phone that shows it doesn't also download the
// TV's October screens.

"use client";

import { useMemo, type CSSProperties } from "react";
import { FLAMING_HEAD, artUrl } from "./art";

export function FlamingHead({ height, style }: { height: number; style?: CSSProperties }) {
  const url = useMemo(() => artUrl(FLAMING_HEAD), []);
  const width = (height * FLAMING_HEAD.width) / FLAMING_HEAD.height;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden
      data-testid="october-flaming-head"
      width={width}
      height={height}
      style={{ display: "block", width, height, flexShrink: 0, ...style }}
    />
  );
}
