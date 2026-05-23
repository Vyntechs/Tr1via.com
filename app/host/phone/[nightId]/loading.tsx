// Suspense fallback for the host phone surface. Renders inside PhoneScreen
// so the loading frame matches the surface Linda actually sees on her
// device.

import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { Spinner } from "@/components/system/Spinner";

export default function HostPhoneLoading() {
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="HOST · PRIVATE" />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
        }}
      >
        <Spinner size="lg" label="Loading host phone" />
      </div>
    </PhoneScreen>
  );
}
