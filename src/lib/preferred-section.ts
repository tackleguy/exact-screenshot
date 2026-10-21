import type { TrailSectionKey } from "@/lib/trail-catalog/activity";

/** Signed-out visitors keep their pick in a cookie (so the server renders the right section); accounts keep it on the profile. */
export const SECTION_COOKIE = "hyked_section";

export function storeSection(section: TrailSectionKey) {
  document.cookie = `${SECTION_COOKIE}=${section}; path=/; max-age=31536000; samesite=lax`;
}
