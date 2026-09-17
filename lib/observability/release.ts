/** Browser-safe build identity and release comparison helpers. */

export const CLIENT_RELEASE_HEADER = "x-tr1via-client-release";
export const CLIENT_DEPLOYMENT_HEADER = "x-tr1via-client-deployment";
export const CLIENT_SURFACE_HEADER = "x-tr1via-surface";

const RELEASE_PATTERN = /^[0-9a-f]{7,64}$/i;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]{6,64}$/;
const SURFACES = ["player", "host_laptop", "host_phone", "tv"] as const;

export type ClientSurface = (typeof SURFACES)[number];

export interface ReleaseIdentity {
  readonly release: string | null;
  readonly deploymentId: string | null;
}

export interface ReleaseEnvironment {
  readonly release?: string;
  readonly deploymentId?: string;
}

/**
 * The literal public names are intentional: Next.js can inline them safely in
 * a browser bundle. No server secret or dynamic process.env lookup belongs in
 * this module.
 */
export function browserReleaseIdentity(
  environment: ReleaseEnvironment = {
    release: process.env.NEXT_PUBLIC_TR1VIA_RELEASE,
    deploymentId: process.env.NEXT_PUBLIC_TR1VIA_DEPLOYMENT_ID,
  },
): Readonly<ReleaseIdentity> {
  return normalizeReleaseIdentity(environment);
}

export function normalizeReleaseIdentity(
  input: ReleaseEnvironment,
): Readonly<ReleaseIdentity> {
  return Object.freeze({
    release: normalizeRelease(input.release),
    deploymentId: normalizeDeploymentId(input.deploymentId),
  });
}

export function releaseState(
  client: ReleaseIdentity,
  server: ReleaseIdentity,
): "same" | "mixed" | "unknown" {
  if (client.deploymentId && server.deploymentId) {
    return client.deploymentId === server.deploymentId ? "same" : "mixed";
  }
  if (client.release && server.release) {
    return client.release === server.release ? "same" : "mixed";
  }
  return "unknown";
}

/** Safe headers for live requests. Empty/invalid values are never emitted. */
export function clientEvidenceHeaders(
  surface: ClientSurface,
  identity: ReleaseIdentity = browserReleaseIdentity(),
): Readonly<Record<string, string>> {
  if (!SURFACES.some((candidate) => candidate === surface)) return Object.freeze({});
  return Object.freeze({
    [CLIENT_SURFACE_HEADER]: surface,
    ...(identity.release ? { [CLIENT_RELEASE_HEADER]: identity.release } : {}),
    ...(identity.deploymentId
      ? { [CLIENT_DEPLOYMENT_HEADER]: identity.deploymentId }
      : {}),
  });
}

/** Reads only the two evidence headers and rejects malformed values. */
export function releaseIdentityFromHeaders(
  headers: Pick<Headers, "get">,
): Readonly<ReleaseIdentity> {
  return normalizeReleaseIdentity({
    release: headers.get(CLIENT_RELEASE_HEADER) ?? undefined,
    deploymentId: headers.get(CLIENT_DEPLOYMENT_HEADER) ?? undefined,
  });
}

export function clientSurfaceFromHeaders(
  headers: Pick<Headers, "get">,
): ClientSurface | null {
  const value = headers.get(CLIENT_SURFACE_HEADER);
  return SURFACES.find((candidate) => candidate === value) ?? null;
}

function normalizeRelease(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && RELEASE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeDeploymentId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && DEPLOYMENT_PATTERN.test(normalized) ? normalized : null;
}
