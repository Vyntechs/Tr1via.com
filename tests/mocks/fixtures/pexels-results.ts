// Canned Pexels API response — 12 photos, the per-page cap the app uses.
//
// Shape matches the official Pexels Photos Search response (see the
// PhotosWithTotalResults type in node_modules/pexels/dist/types.d.ts).
// The app destructures `photos[].src.{medium,large,large2x,original}`,
// `photographer`, `photographer_url`, `alt`, `url`, and `id`.
//
// We point every src URL at placehold.co so a real PNG resolves in
// browsers during screenshot tests — no broken-image flicker.

interface PexelsPhotoSrc {
  original: string;
  large2x: string;
  large: string;
  medium: string;
  small: string;
  portrait: string;
  landscape: string;
  tiny: string;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt: string;
  avg_color: string;
  photographer: string;
  photographer_url: string;
  photographer_id: number;
  liked: boolean;
  src: PexelsPhotoSrc;
}

interface PexelsPhotosResponse {
  page: number;
  per_page: number;
  total_results: number;
  next_page: string;
  url: string;
  photos: PexelsPhoto[];
}

function makePhoto(i: number): PexelsPhoto {
  const id = 1000 + i;
  const label = `Pixar+Test+${i + 1}`;
  const base = (w: number, h: number) =>
    `https://placehold.co/${w}x${h}/png?text=${label}`;
  return {
    id,
    width: 1280,
    height: 720,
    url: `https://www.pexels.com/photo/test-photo-${id}/`,
    alt: `Test Pexels photo ${i + 1}`,
    avg_color: "#888888",
    photographer: `Test Photographer ${i + 1}`,
    photographer_url: `https://www.pexels.com/@test-photog-${i + 1}/`,
    photographer_id: 90000 + i,
    liked: false,
    src: {
      original: base(1280, 720),
      large2x: base(1880, 1280),
      large: base(940, 650),
      medium: base(800, 450),
      small: base(400, 225),
      portrait: base(800, 1200),
      landscape: base(1200, 800),
      tiny: base(280, 200),
    },
  };
}

export const PEXELS_RESPONSE: PexelsPhotosResponse = {
  page: 1,
  per_page: 12,
  total_results: 12,
  next_page: "https://api.pexels.com/v1/search?page=2&per_page=12&query=test",
  url: "https://api.pexels.com/v1/search?page=1&per_page=12&query=test",
  photos: Array.from({ length: 12 }, (_, i) => makePhoto(i)),
};
