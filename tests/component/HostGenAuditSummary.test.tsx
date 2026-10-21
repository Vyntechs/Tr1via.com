import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/system";
import { HostGenAuditSummary } from "@/components/host/gen/HostGenAuditSummary";

afterEach(cleanup);

describe("HostGenAuditSummary", () => {
  it("renders compact accepted, image, and risk metrics without a cost line", () => {
    render(
      <ThemeProvider themeKey="house">
        <HostGenAuditSummary
          summary={{
            acceptedCount: 20,
            generatedCount: 27,
            verifyPasses: 2,
            imageTargetCount: 20,
            imageAttachedCount: 18,
            riskFlagCount: 3,
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("20 accepted from 27 candidates")).toBeInTheDocument();
    expect(screen.getByText("2 verification passes")).toBeInTheDocument();
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
    expect(screen.getByText("Images: 20 attempted, 18 attached")).toBeInTheDocument();
    expect(screen.getByText("3 wording flags to review")).toBeInTheDocument();
  });
});
