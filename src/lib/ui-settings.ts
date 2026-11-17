/**
 * Persistent UI & map customization settings stored in localStorage ("hyked:ui-settings").
 * Changes dispatch UI_SETTINGS_EVENT and immediately update semantic data-* attributes on <html>
 * so every page in both the static Vite client and Next.js responds without a reload.
 */

export type UiTheme = "midnight" | "forest" | "light" | "oled" | "system";
export type UiAccent = "emerald" | "amber" | "sky" | "coral" | "gold";
export type UiFontScale = "sm" | "md" | "lg";
export type UiDensity = "comfortable" | "compact";
export type UiHeadingFont = "sans" | "serif";
export type UiCornerStyle = "sharp" | "default" | "rounded";

export type DefaultBasemapKey =
  | "topo"
  | "vfr"
  | "ifr"
  | "outdoors"
  | "terrain"
  | "relief"
  | "natgeo"
  | "usgs"
  | "usgs-imagery"
  | "satellite"
  | "hybrid"
  | "standard"
  | "bright"
  | "light"
  | "dark";

export interface UiSettings {
  theme: UiTheme;
  accent: UiAccent;
  fontScale: UiFontScale;
  density: UiDensity;
  headingFont: UiHeadingFont;
  cornerStyle: UiCornerStyle;
  sidebarCollapsed: boolean;
  showBackdrop: boolean;
  reducedMotion: boolean;
  defaultBasemap: DefaultBasemapKey;
  default3d: boolean;
  terrainExaggeration: number;
  aeroChartOpacity: number;
}

export const UI_SETTINGS_KEY = "hyked:ui-settings";
export const UI_SETTINGS_EVENT = "hyked:ui-settings";

export const DEFAULT_UI_SETTINGS: Readonly<UiSettings> = {
  theme: "midnight",
  accent: "emerald",
  fontScale: "md",
  density: "comfortable",
  headingFont: "sans",
  cornerStyle: "default",
  sidebarCollapsed: false,
  showBackdrop: true,
  reducedMotion: false,
  defaultBasemap: "topo",
  default3d: false,
  terrainExaggeration: 1.5,
  aeroChartOpacity: 0.88,
};

const VALID_THEMES: readonly UiTheme[] = ["midnight", "forest", "light", "oled", "system"];
const VALID_ACCENTS: readonly UiAccent[] = ["emerald", "amber", "sky", "coral", "gold"];
const VALID_SCALES: readonly UiFontScale[] = ["sm", "md", "lg"];
const VALID_DENSITIES: readonly UiDensity[] = ["comfortable", "compact"];
const VALID_FONTS: readonly UiHeadingFont[] = ["sans", "serif"];
const VALID_CORNERS: readonly UiCornerStyle[] = ["sharp", "default", "rounded"];
const VALID_BASEMAPS: readonly DefaultBasemapKey[] = [
  "topo",
  "vfr",
  "ifr",
  "outdoors",
  "terrain",
  "relief",
  "natgeo",
  "usgs",
  "usgs-imagery",
  "satellite",
  "hybrid",
  "standard",
  "bright",
  "light",
  "dark",
];

const FONT_PX: Record<UiFontScale, string> = {
  sm: "15px",
  md: "16px",
  lg: "17.25px",
};

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function pick<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  return typeof val === "string" && (allowed as readonly string[]).includes(val) ? (val as T) : fallback;
}

export function normalizeUiSettings(raw: unknown): UiSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_UI_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    theme: pick(obj.theme, VALID_THEMES, DEFAULT_UI_SETTINGS.theme),
    accent: pick(obj.accent, VALID_ACCENTS, DEFAULT_UI_SETTINGS.accent),
    fontScale: pick(obj.fontScale, VALID_SCALES, DEFAULT_UI_SETTINGS.fontScale),
    density: pick(obj.density, VALID_DENSITIES, DEFAULT_UI_SETTINGS.density),
    headingFont: pick(obj.headingFont, VALID_FONTS, DEFAULT_UI_SETTINGS.headingFont),
    cornerStyle: pick(obj.cornerStyle, VALID_CORNERS, DEFAULT_UI_SETTINGS.cornerStyle),
    sidebarCollapsed: typeof obj.sidebarCollapsed === "boolean" ? obj.sidebarCollapsed : DEFAULT_UI_SETTINGS.sidebarCollapsed,
    showBackdrop: typeof obj.showBackdrop === "boolean" ? obj.showBackdrop : DEFAULT_UI_SETTINGS.showBackdrop,
    reducedMotion: typeof obj.reducedMotion === "boolean" ? obj.reducedMotion : DEFAULT_UI_SETTINGS.reducedMotion,
    defaultBasemap: pick(obj.defaultBasemap, VALID_BASEMAPS, DEFAULT_UI_SETTINGS.defaultBasemap),
    default3d: typeof obj.default3d === "boolean" ? obj.default3d : DEFAULT_UI_SETTINGS.default3d,
    terrainExaggeration: clamp(obj.terrainExaggeration, 1, 2.5, DEFAULT_UI_SETTINGS.terrainExaggeration),
    aeroChartOpacity: clamp(obj.aeroChartOpacity, 0.35, 1, DEFAULT_UI_SETTINGS.aeroChartOpacity),
  };
}

let cachedRaw: string | null | undefined;
let cachedSnapshot: UiSettings = DEFAULT_UI_SETTINGS;

/** Reads current UI settings with referential stability for useSyncExternalStore. */
export function getUiSettings(): UiSettings {
  if (typeof localStorage === "undefined") return DEFAULT_UI_SETTINGS;
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    cachedSnapshot = raw ? normalizeUiSettings(JSON.parse(raw)) : { ...DEFAULT_UI_SETTINGS };
    return cachedSnapshot;
  } catch {
    return DEFAULT_UI_SETTINGS;
  }
}

export function resolveEffectiveTheme(theme: UiTheme): Exclude<UiTheme, "system"> {
  if (theme !== "system") return theme;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "midnight";
  }
  return "midnight";
}

/** Applies UI settings as semantic data attributes and root CSS variables on <html>. */
export function applyUiSettingsToDocument(settings: UiSettings = getUiSettings()): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const effectiveTheme = resolveEffectiveTheme(settings.theme);
  root.dataset.theme = effectiveTheme;
  root.dataset.themePref = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.density = settings.density;
  root.dataset.headingFont = settings.headingFont;
  root.dataset.corners = settings.cornerStyle;
  root.dataset.backdrop = settings.showBackdrop ? "on" : "off";
  root.dataset.motion = settings.reducedMotion ? "reduced" : "normal";
  root.style.fontSize = FONT_PX[settings.fontScale];
  root.style.colorScheme = effectiveTheme === "light" ? "light" : "dark";
}

export function updateUiSettings(patch: Partial<UiSettings>): UiSettings {
  const current = getUiSettings();
  const next = normalizeUiSettings({ ...current, ...patch });
  try {
    const serialized = JSON.stringify(next);
    localStorage.setItem(UI_SETTINGS_KEY, serialized);
    cachedRaw = serialized;
    cachedSnapshot = next;
    if (patch.defaultBasemap) {
      localStorage.setItem("hyked:basemap", next.defaultBasemap);
    }
  } catch {
    cachedSnapshot = next;
  }
  applyUiSettingsToDocument(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UI_SETTINGS_EVENT));
  }
  return next;
}

export function resetUiSettings(): UiSettings {
  try {
    localStorage.removeItem(UI_SETTINGS_KEY);
    localStorage.setItem("hyked:basemap", DEFAULT_UI_SETTINGS.defaultBasemap);
  } catch {
    /* storage unavailable */
  }
  cachedRaw = null;
  cachedSnapshot = { ...DEFAULT_UI_SETTINGS };
  applyUiSettingsToDocument(cachedSnapshot);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UI_SETTINGS_EVENT));
  }
  return cachedSnapshot;
}

export function isDefaultUiSettings(s: UiSettings): boolean {
  return (Object.keys(DEFAULT_UI_SETTINGS) as (keyof UiSettings)[]).every(
    (k) => s[k] === DEFAULT_UI_SETTINGS[k],
  );
}
