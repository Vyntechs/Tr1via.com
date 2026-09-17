import { describe, expect, test } from "vitest";

import {
  browserReleaseIdentity,
  clientEvidenceHeaders,
  clientSurfaceFromHeaders,
  normalizeReleaseIdentity,
  releaseIdentityFromHeaders,
  releaseState,
} from "@/lib/observability/release";
import { serverReleaseIdentity } from "@/lib/observability/serverRelease";

const RELEASE_A = "a9e3a2c012345678901234567890123456789012";
const RELEASE_B = "b9e3a2c012345678901234567890123456789012";
const DEPLOYMENT_A = "dpl_4VK2iNCkbZ6VQrMisCapG5qpaced";
const DEPLOYMENT_B = "dpl_4kTdY8jcsYkG3UjTJzkeSnhtRuQj";

describe("release identity", () => {
  test("normalizes safe build identity and rejects arbitrary text", () => {
    expect(normalizeReleaseIdentity({
      release: `  ${RELEASE_A.toUpperCase()}  `,
      deploymentId: ` ${DEPLOYMENT_A} `,
    })).toEqual({ release: RELEASE_A, deploymentId: DEPLOYMENT_A });
    expect(normalizeReleaseIdentity({
      release: "main; cookie=private",
      deploymentId: "https://deployment.example",
    })).toEqual({ release: null, deploymentId: null });
  });

  test("supports separately injectable browser and server environments", () => {
    expect(browserReleaseIdentity({
      release: RELEASE_A,
      deploymentId: DEPLOYMENT_A,
    })).toEqual({ release: RELEASE_A, deploymentId: DEPLOYMENT_A });
    expect(serverReleaseIdentity({
      release: RELEASE_B,
      deploymentId: DEPLOYMENT_B,
    })).toEqual({ release: RELEASE_B, deploymentId: DEPLOYMENT_B });
  });

  test("prefers deployment identity so a redeploy of one commit is detectable", () => {
    expect(releaseState(
      { release: RELEASE_A, deploymentId: DEPLOYMENT_A },
      { release: RELEASE_A, deploymentId: DEPLOYMENT_B },
    )).toBe("mixed");
    expect(releaseState(
      { release: RELEASE_A, deploymentId: null },
      { release: RELEASE_A, deploymentId: null },
    )).toBe("same");
    expect(releaseState(
      { release: null, deploymentId: null },
      { release: RELEASE_A, deploymentId: DEPLOYMENT_A },
    )).toBe("unknown");
  });

  test("creates and parses only bounded release headers", () => {
    const headers = clientEvidenceHeaders("player", {
      release: RELEASE_A,
      deploymentId: DEPLOYMENT_A,
    });
    expect(headers).toEqual({
      "x-tr1via-surface": "player",
      "x-tr1via-client-release": RELEASE_A,
      "x-tr1via-client-deployment": DEPLOYMENT_A,
    });
    const parsedHeaders = new Headers({
      ...headers,
      cookie: "tr1via_device=private",
      authorization: "Bearer private",
    });
    expect(releaseIdentityFromHeaders(parsedHeaders)).toEqual({
      release: RELEASE_A,
      deploymentId: DEPLOYMENT_A,
    });
    expect(clientSurfaceFromHeaders(parsedHeaders)).toBe("player");
  });

  test("drops malformed client headers instead of logging them", () => {
    const headers = new Headers({
      "x-tr1via-client-release": "roger@example.com",
      "x-tr1via-client-deployment": "cookie=private",
      "x-tr1via-surface": "player:roger",
    });
    expect(releaseIdentityFromHeaders(headers)).toEqual({
      release: null,
      deploymentId: null,
    });
    expect(clientSurfaceFromHeaders(headers)).toBeNull();
  });
});
