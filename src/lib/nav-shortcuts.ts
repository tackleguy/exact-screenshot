/** Desktop navigation shortcuts — shown on hover and on Profile. */
export const NAV_SHORTCUTS = [
  { keys: "Ctrl/⌘ B or [", label: "Toggle sidebar" },
  { keys: "↑ / ↓", label: "Move between sidebar buttons" },
  { keys: "Home / End", label: "First / last sidebar button" },
  { keys: "Enter", label: "Open focused page" },
  { keys: "G then E", label: "Explore", href: "/explore/trails", chord: "e" },
  { keys: "G then T", label: "My trips", href: "/plan", chord: "t" },
  { keys: "G then G", label: "Gear", href: "/gear", chord: "g" },
  { keys: "G then R", label: "Record activity", href: "/record", chord: "r" },
  { keys: "G then P", label: "Profile", href: "/you", chord: "p" },
  { keys: "G then M", label: "Trail map", href: "/map", chord: "m" },
  { keys: "G then A", label: "Activity log", href: "/activity", chord: "a" },
] as const;
