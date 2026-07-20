const HOST_PHONE_MEDIA_QUERY = "(max-width: 860px)";

export function hostRunPath(nightId: string): string {
  const usePhoneController =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(HOST_PHONE_MEDIA_QUERY).matches;

  return usePhoneController
    ? `/host/phone/${nightId}`
    : `/host/live/${nightId}`;
}
