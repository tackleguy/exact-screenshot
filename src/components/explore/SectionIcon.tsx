import type { TrailSectionKey } from "@/lib/trail-catalog/activity";

/** Drawn on the same 24px, 1.75-stroke grid as NavIcon. */
export function SectionIcon({ section, size = 22 }: { section: TrailSectionKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {section === "foot" && (
        <>
          <path d="M3 20 10 6l4 7 2-3 5 10H3Z" />
          <path d="m8.5 9 1.5 2 1.6-1.4" />
        </>
      )}
      {section === "bike" && (
        <>
          <circle cx="5.5" cy="16.5" r="3.5" />
          <circle cx="18.5" cy="16.5" r="3.5" />
          <path d="M5.5 16.5 9 9.5h6.5l3 7M9 9.5l3.5 7h-7M15.5 9.5 12.5 16.5M8 7h3M14.5 6.5h2.5l-1.5 3" />
        </>
      )}
      {section === "horse" && (
        <>
          <path d="M6 20v-7.5a6 6 0 0 1 12 0V20" />
          <path d="M4.5 20h3M16.5 20h3M8.5 15.5v.01M15.5 15.5v.01M9.5 10.5v.01M14.5 10.5v.01" />
        </>
      )}
      {section === "water" && (
        <>
          <path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17" />
          <path d="M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21" />
          <path d="m15 3-6 11M7.5 13.5l3 1.5" />
        </>
      )}
      {section === "snow" && (
        <>
          <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
          <path d="m9.5 4.5 2.5 2.5 2.5-2.5M9.5 19.5l2.5-2.5 2.5 2.5" />
        </>
      )}
    </svg>
  );
}
