import type { CSSProperties } from "react";
// The same editable vector paths used to construct the approved Figma file.
const paths = {
  mountain: "M3 20 10 5l4 7 2-4 5 12H3Zm5-11 3 3 2-2",
  explore: "M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z",
  map: "M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5Z",
  trips: "M9 20l-6-3V5l6 2 6-3 6 3v13l-6-3-6 3Zm0 0V7m6 10V4",
  gear: "M8 7V5a4 4 0 018 0v2M6 7h12l2 14H4L6 7Zm2 7h8v4H8v-4",
  profile: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  record: "M12 3a9 9 0 100 18 9 9 0 000-18Zm0 5a4 4 0 100 8 4 4 0 000-8Z",
  chevron: "m9 5 7 7-7 7",
  filters: "M3 7h4m4 0h10M3 17h10m4 0h4M7 4v6m10 4v6",
  more: "M12 6.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5Zm0 7a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5Zm0 7a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5Z",
} as const;
export function NavIcon({ name, style }: { name: keyof typeof paths; style?: CSSProperties }) {
  const dotted = name === "more";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={style}>
      <path
        d={paths[name]}
        fill={dotted ? "currentColor" : "none"}
        stroke={dotted ? "none" : "currentColor"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
