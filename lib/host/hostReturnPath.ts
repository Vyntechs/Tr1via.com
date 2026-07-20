/**
 * Preserve an intended host destination without turning sign-in into an open
 * redirect. Host entry is account-first, so absolute URLs and lookalike paths
 * always fall back to the dashboard.
 */
export function hostReturnPath(value: string | null): string {
  if (!value || value.startsWith("//")) return "/host";
  if (value === "/host" || value.startsWith("/host/") || value.startsWith("/host?")) {
    return value;
  }
  return "/host";
}
