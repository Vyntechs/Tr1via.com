// 404 inside any /host/* segment. Renders inside LaptopShell so a host who
// hits a bad night id (deleted, wrong account, expired link) stays inside
// the host visual frame and gets a clear "back to dashboard" CTA.

import Link from "next/link";
import { LaptopShell } from "@/components/shells/LaptopShell";
import { EmptyState } from "@/components/system/EmptyState";

export default function HostNotFound() {
  return (
    <LaptopShell title="tr1via.com / host">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 32px",
        }}
      >
        <EmptyState
          eyebrow="HOST · 404"
          title="That night isn't here."
          description="It may have been removed, or the link is from a different account. Head back to your dashboard."
          action={
            <Link
              href="/host"
              style={{
                display: "inline-block",
                background: "var(--accent)",
                color: "#FFF",
                padding: "14px 24px",
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 15,
                textDecoration: "none",
                boxShadow: "0 12px 28px -10px var(--accent)",
              }}
            >
              Back to dashboard  →
            </Link>
          }
          style={{ alignItems: "center", textAlign: "center" }}
        />
      </div>
    </LaptopShell>
  );
}
