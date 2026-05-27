// Suspense fallback for the host setup overview. The page itself fetches
// the night + games + categories before painting; while that's in flight we
// hold this neutral "preparing your board" panel inside LaptopShell.

import { LaptopShell } from "@/components/shells/LaptopShell";
import { Spinner } from "@/components/system/Spinner";
import { Eyebrow } from "@/components/system/Eyebrow";

export default function HostSetupLoading() {
  return (
    <LaptopShell>
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
        <Spinner size="lg" label="Loading your setup" />
        <Eyebrow color="var(--ink-mid)" size={11}>
          LAYING OUT YOUR BOARD
        </Eyebrow>
      </div>
    </LaptopShell>
  );
}
