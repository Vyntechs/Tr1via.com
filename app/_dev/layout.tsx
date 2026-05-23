// Layout for /_dev/* routes. Strip nothing — these are internal canvases for
// previewing the design system and screens. Real app surfaces have their own
// route-group layouts.

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
