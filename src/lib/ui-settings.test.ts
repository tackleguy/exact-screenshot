import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUiSettingsToDocument,
  DEFAULT_UI_SETTINGS,
  getUiSettings,
  isDefaultUiSettings,
  normalizeUiSettings,
  resetUiSettings,
  resolveEffectiveTheme,
  UI_SETTINGS_KEY,
  updateUiSettings,
} from "./ui-settings";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

test("normalizeUiSettings clamps numeric sliders and rejects unknown enum values", () => {
  const clean = normalizeUiSettings({
    theme: "forest",
    accent: "amber",
    fontScale: "lg",
    density: "compact",
    headingFont: "serif",
    cornerStyle: "rounded",
    sidebarCollapsed: true,
    showBackdrop: false,
    reducedMotion: true,
    defaultBasemap: "vfr",
    default3d: true,
    terrainExaggeration: 9.9,
    aeroChartOpacity: 0.05,
  });

  assert.equal(clean.theme, "forest");
  assert.equal(clean.accent, "amber");
  assert.equal(clean.fontScale, "lg");
  assert.equal(clean.density, "compact");
  assert.equal(clean.headingFont, "serif");
  assert.equal(clean.cornerStyle, "rounded");
  assert.equal(clean.sidebarCollapsed, true);
  assert.equal(clean.showBackdrop, false);
  assert.equal(clean.reducedMotion, true);
  assert.equal(clean.defaultBasemap, "vfr");
  assert.equal(clean.default3d, true);
  assert.equal(clean.terrainExaggeration, 2.5);
  assert.equal(clean.aeroChartOpacity, 0.35);

  const fallback = normalizeUiSettings({
    theme: "purple-neon",
    accent: "violet",
    defaultBasemap: "mars",
    terrainExaggeration: NaN,
  });
  assert.equal(fallback.theme, DEFAULT_UI_SETTINGS.theme);
  assert.equal(fallback.accent, DEFAULT_UI_SETTINGS.accent);
  assert.equal(fallback.defaultBasemap, DEFAULT_UI_SETTINGS.defaultBasemap);
  assert.equal(fallback.terrainExaggeration, DEFAULT_UI_SETTINGS.terrainExaggeration);
  assert.equal(isDefaultUiSettings(fallback), true);
});

test("updateUiSettings and resetUiSettings persist to localStorage and sync document dataset", () => {
  const prevStorage = globalThis.localStorage;
  const prevDocument = globalThis.document;
  const storage = makeMemoryStorage();
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};

  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "document", {
    value: { documentElement: { dataset, style } },
    configurable: true,
  });

  try {
    resetUiSettings();
    assert.equal(isDefaultUiSettings(getUiSettings()), true);

    const updated = updateUiSettings({
      theme: "light",
      accent: "sky",
      fontScale: "lg",
      cornerStyle: "sharp",
      defaultBasemap: "ifr",
      aeroChartOpacity: 0.75,
    });

    assert.equal(updated.theme, "light");
    assert.equal(updated.defaultBasemap, "ifr");
    assert.equal(storage.getItem("hyked:basemap"), "ifr");
    assert.ok(storage.getItem(UI_SETTINGS_KEY)?.includes('"defaultBasemap":"ifr"'));
    assert.equal(dataset.theme, "light");
    assert.equal(dataset.accent, "sky");
    assert.equal(dataset.corners, "sharp");
    assert.equal(style.fontSize, "17.25px");
    assert.equal(style.colorScheme, "light");

    applyUiSettingsToDocument(normalizeUiSettings({ theme: "system" }));
    assert.equal(resolveEffectiveTheme("midnight"), "midnight");

    const reset = resetUiSettings();
    assert.equal(isDefaultUiSettings(reset), true);
    assert.equal(dataset.theme, "midnight");
    assert.equal(storage.getItem("hyked:basemap"), "topo");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prevStorage, configurable: true });
    Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
  }
});
