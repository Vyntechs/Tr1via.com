// Suspense fallback for the host pick route — the flagship setup screen
// where questions are generated + picked. The page itself swaps between
// HostGenLoading and HostGenPick once it has the live category data; this
// fallback covers the very first request while the server reads the row.

import { LaptopShell } from "@/components/shells/LaptopShell";
import { Spinner } from "@/components/system/Spinner";
import { Eyebrow } from "@/components/system/Eyebrow";

export default function HostSetupPickLoading() {
  return (
    <LaptopShell title="tr1via.com / host / setup / pick">
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
        <Spinner size="lg" label="Loading this category" />
        <Eyebrow color="var(--ink-mid)" size={11}>
          PULLING UP YOUR QUESTIONS
        </Eyebrow>
      </div>
    </LaptopShell>
  );
}
