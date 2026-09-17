import "server-only";

import {
  clientSurfaceFromHeaders,
  releaseIdentityFromHeaders,
  releaseState,
} from "./release";
import { recordGameEvidence } from "./gameEvidence";
import { serverReleaseIdentity } from "./serverRelease";

export function requestEvidenceContext(request: Request) {
  const client = releaseIdentityFromHeaders(request.headers);
  const server = serverReleaseIdentity();
  const surface = clientSurfaceFromHeaders(request.headers);
  return {
    client,
    server,
    surface,
    state: releaseState(client, server),
    traceId: safeTraceId(request.headers.get("x-vercel-id")),
  } as const;
}

export async function recordReleaseMismatchBestEffort(
  context: ReturnType<typeof requestEvidenceContext>,
): Promise<void> {
  if (context.state !== "mixed" || !context.surface) return;
  await recordGameEvidence({
    event: "game_release_mismatch",
    surface: context.surface,
    releaseState: context.state,
    ...(context.client.release ? { clientRelease: context.client.release } : {}),
    ...(context.client.deploymentId
      ? { clientDeploymentId: context.client.deploymentId }
      : {}),
    ...(context.server.release ? { serverRelease: context.server.release } : {}),
    ...(context.server.deploymentId
      ? { serverDeploymentId: context.server.deploymentId }
      : {}),
  });
}

function safeTraceId(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : undefined;
}
