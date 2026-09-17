import "server-only";

import {
  normalizeReleaseIdentity,
  type ReleaseEnvironment,
  type ReleaseIdentity,
} from "./release";

/** Server-only counterpart to browserReleaseIdentity; never enters a client bundle. */
export function serverReleaseIdentity(
  environment: ReleaseEnvironment = {
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  },
): Readonly<ReleaseIdentity> {
  return normalizeReleaseIdentity(environment);
}
