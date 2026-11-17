"use client";

import Link from "next/link";
import { BASEMAPS } from "@/components/explore/explorer-map";
import {
  isDefaultUiSettings,
  resetUiSettings,
  updateUiSettings,
  type DefaultBasemapKey,
  type UiAccent,
  type UiCornerStyle,
  type UiDensity,
  type UiFontScale,
  type UiHeadingFont,
  type UiTheme,
} from "@/lib/ui-settings";
import { useUiSettings } from "@/lib/use-ui-settings";
import { formatDistance, formatElevation, setUnits } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

const THEMES: readonly {
  key: UiTheme;
  label: string;
  hint: string;
  bg: string;
  surface: string;
  chip: string;
}[] = [
  { key: "midnight", label: "Midnight", hint: "Deep slate", bg: "#101215", surface: "#171a1f", chip: "#3ecf8e" },
  { key: "forest", label: "Evergreen", hint: "Pine canopy", bg: "#0b1410", surface: "#111f19", chip: "#4ade80" },
  { key: "light", label: "Daylight", hint: "Warm paper", bg: "#f5f4ef", surface: "#ffffff", chip: "#0d8a52" },
  { key: "oled", label: "Pitch Black", hint: "True black", bg: "#000000", surface: "#0a0c0e", chip: "#3ecf8e" },
  { key: "system", label: "System", hint: "Match device", bg: "linear-gradient(135deg, #101215 50%, #f5f4ef 50%)", surface: "#1f242b", chip: "#3ecf8e" },
];

const ACCENTS: readonly { key: UiAccent; label: string; swatch: string }[] = [
  { key: "emerald", label: "Pine Emerald", swatch: "#3ecf8e" },
  { key: "amber", label: "Alpine Amber", swatch: "#f59e0b" },
  { key: "sky", label: "Glacier Sky", swatch: "#38bdf8" },
  { key: "coral", label: "Canyon Coral", swatch: "#fb7185" },
  { key: "gold", label: "Summit Gold", swatch: "#eab308" },
];

const SCALES: readonly { key: UiFontScale; label: string }[] = [
  { key: "sm", label: "Compact" },
  { key: "md", label: "Default" },
  { key: "lg", label: "Large" },
];

const FONTS: readonly { key: UiHeadingFont; label: string }[] = [
  { key: "sans", label: "Sans-serif" },
  { key: "serif", label: "Editorial serif" },
];

const DENSITIES: readonly { key: UiDensity; label: string }[] = [
  { key: "comfortable", label: "Comfortable" },
  { key: "compact", label: "Compact" },
];

const CORNERS: readonly { key: UiCornerStyle; label: string }[] = [
  { key: "sharp", label: "Sharp" },
  { key: "default", label: "Default" },
  { key: "rounded", label: "Rounded" },
];

export function SettingsView() {
  const settings = useUiSettings();
  const units = useUnits();
  const atDefaults = isDefaultUiSettings(settings);
  const activeBasemapLabel =
    BASEMAPS.find((b) => b.key === settings.defaultBasemap)?.label ?? "Topo";

  return (
    <section className="fieldbook-page">
      <header className="settings-header">
        <div>
          <p className="section-label">Workspace preferences</p>
          <h1>Settings &amp; appearance</h1>
          <p className="mt-2 max-w-2xl text-sm text-sage">
            Customize theme, accent colors, typography, layout density, and 3D VFR / IFR aeronautical map defaults. Changes apply immediately and stay saved on this device.
          </p>
        </div>
        <div className="settings-header-actions">
          <Link id="settings-back-map" className="btn-ghost" href="/explore/trails">
            Back to map
          </Link>
          <button
            id="settings-reset-btn"
            type="button"
            className="btn-ghost"
            disabled={atDefaults}
            onClick={() => resetUiSettings()}
          >
            Reset to defaults
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <div className="settings-stack">
          <section className="settings-panel" aria-labelledby="settings-theme-heading">
            <div className="settings-panel-head">
              <h2 id="settings-theme-heading">Theme &amp; color palette</h2>
              <p>Choose an outdoor surface palette for daytime planning or night-vision trail reading.</p>
            </div>

            <div className="settings-theme-grid" role="group" aria-label="Color theme">
              {THEMES.map((theme) => (
                <button
                  key={theme.key}
                  id={`settings-theme-${theme.key}`}
                  type="button"
                  className="settings-theme-card"
                  aria-pressed={settings.theme === theme.key}
                  onClick={() => updateUiSettings({ theme: theme.key })}
                >
                  <span
                    className="settings-theme-swatch"
                    style={{ background: theme.bg }}
                    aria-hidden="true"
                  >
                    <i style={{ background: theme.surface }} />
                    <i style={{ background: theme.chip }} />
                  </span>
                  <span>
                    <strong>{theme.label}</strong>
                    <small>{theme.hint}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="settings-field">
              <span className="settings-field-label">Accent color</span>
              <div className="settings-accent-row" role="group" aria-label="Accent color">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.key}
                    id={`settings-accent-${accent.key}`}
                    type="button"
                    className="settings-accent-btn"
                    aria-pressed={settings.accent === accent.key}
                    onClick={() => updateUiSettings({ accent: accent.key })}
                  >
                    <span
                      className="settings-accent-dot"
                      style={{ background: accent.swatch }}
                      aria-hidden="true"
                    />
                    {accent.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-panel" aria-labelledby="settings-layout-heading">
            <div className="settings-panel-head">
              <h2 id="settings-layout-heading">Typography, layout &amp; motion</h2>
              <p>Adjust reading scale, heading character, spacing density, and workspace chrome.</p>
            </div>

            <div className="settings-field-grid">
              <div className="settings-field">
                <span className="settings-field-label">Text size</span>
                <div className="settings-segmented" role="group" aria-label="Text size">
                  {SCALES.map((scale) => (
                    <button
                      key={scale.key}
                      id={`settings-scale-${scale.key}`}
                      type="button"
                      aria-pressed={settings.fontScale === scale.key}
                      onClick={() => updateUiSettings({ fontScale: scale.key })}
                    >
                      {scale.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <span className="settings-field-label">Heading typeface</span>
                <div className="settings-segmented" role="group" aria-label="Heading typeface">
                  {FONTS.map((font) => (
                    <button
                      key={font.key}
                      id={`settings-font-${font.key}`}
                      type="button"
                      aria-pressed={settings.headingFont === font.key}
                      onClick={() => updateUiSettings({ headingFont: font.key })}
                    >
                      {font.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <span className="settings-field-label">Layout density</span>
                <div className="settings-segmented" role="group" aria-label="Layout density">
                  {DENSITIES.map((density) => (
                    <button
                      key={density.key}
                      id={`settings-density-${density.key}`}
                      type="button"
                      aria-pressed={settings.density === density.key}
                      onClick={() => updateUiSettings({ density: density.key })}
                    >
                      {density.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <span className="settings-field-label">Corner geometry</span>
                <div className="settings-segmented" role="group" aria-label="Corner geometry">
                  {CORNERS.map((corner) => (
                    <button
                      key={corner.key}
                      id={`settings-corners-${corner.key}`}
                      type="button"
                      aria-pressed={settings.cornerStyle === corner.key}
                      onClick={() => updateUiSettings({ cornerStyle: corner.key })}
                    >
                      {corner.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-toggles">
              <label className="settings-toggle-row" htmlFor="settings-sidebar-collapsed">
                <span className="settings-toggle-copy">
                  <strong>Collapse desktop sidebar by default</strong>
                  <small>Use the compact icon rail so maps and trail catalogs get maximum width.</small>
                </span>
                <input
                  id="settings-sidebar-collapsed"
                  type="checkbox"
                  checked={settings.sidebarCollapsed}
                  onChange={(e) => updateUiSettings({ sidebarCollapsed: e.target.checked })}
                />
              </label>

              <label className="settings-toggle-row" htmlFor="settings-show-backdrop">
                <span className="settings-toggle-copy">
                  <strong>Ambient mountain backdrop</strong>
                  <small>Show the subtle night-ridge photograph behind catalog and planning pages.</small>
                </span>
                <input
                  id="settings-show-backdrop"
                  type="checkbox"
                  checked={settings.showBackdrop}
                  onChange={(e) => updateUiSettings({ showBackdrop: e.target.checked })}
                />
              </label>

              <label className="settings-toggle-row" htmlFor="settings-reduced-motion">
                <span className="settings-toggle-copy">
                  <strong>Reduce animations &amp; transitions</strong>
                  <small>Minimize page fades and UI transitions across all views.</small>
                </span>
                <input
                  id="settings-reduced-motion"
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(e) => updateUiSettings({ reducedMotion: e.target.checked })}
                />
              </label>
            </div>
          </section>

          <section className="settings-panel" aria-labelledby="settings-map-heading">
            <div className="settings-panel-head">
              <h2 id="settings-map-heading">Units &amp; 3D aeronautical maps</h2>
              <p>
                Configure distance/elevation units, default basemap, 3D DEM relief exaggeration, and FAA VFR Sectional / IFR Enroute chart overlays.
              </p>
            </div>

            <div className="settings-field-grid">
              <div className="settings-field">
                <span className="settings-field-label">Measurement units</span>
                <div className="settings-segmented" role="group" aria-label="Measurement units">
                  <button
                    id="settings-units-imperial"
                    type="button"
                    aria-pressed={units === "imperial"}
                    onClick={() => setUnits("imperial")}
                  >
                    Imperial · mi, ft
                  </button>
                  <button
                    id="settings-units-metric"
                    type="button"
                    aria-pressed={units === "metric"}
                    onClick={() => setUnits("metric")}
                  >
                    Metric · km, m
                  </button>
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="settings-default-basemap">
                  Default map style
                </label>
                <select
                  id="settings-default-basemap"
                  className="settings-select"
                  value={settings.defaultBasemap}
                  onChange={(e) =>
                    updateUiSettings({ defaultBasemap: e.target.value as DefaultBasemapKey })
                  }
                >
                  {BASEMAPS.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="settings-toggles">
              <label className="settings-toggle-row" htmlFor="settings-default-3d">
                <span className="settings-toggle-copy">
                  <strong>Start trail map in 3D terrain</strong>
                  <small>
                    Opens the explorer pitched at 60° over AWS Terrarium elevation relief. 3D VFR &amp; IFR charts always enable 3D terrain automatically.
                  </small>
                </span>
                <input
                  id="settings-default-3d"
                  type="checkbox"
                  checked={settings.default3d}
                  onChange={(e) => updateUiSettings({ default3d: e.target.checked })}
                />
              </label>
            </div>

            <div className="settings-slider-row">
              <div className="settings-slider-head">
                <label htmlFor="settings-terrain-exaggeration">3D terrain vertical relief</label>
                <span>{settings.terrainExaggeration.toFixed(1)}×</span>
              </div>
              <input
                id="settings-terrain-exaggeration"
                type="range"
                min={1}
                max={2.5}
                step={0.1}
                value={settings.terrainExaggeration}
                onChange={(e) =>
                  updateUiSettings({ terrainExaggeration: Number(e.target.value) })
                }
              />
            </div>

            <div className="settings-slider-row">
              <div className="settings-slider-head">
                <label htmlFor="settings-aero-opacity">FAA VFR / IFR chart opacity</label>
                <span>{Math.round(settings.aeroChartOpacity * 100)}%</span>
              </div>
              <input
                id="settings-aero-opacity"
                type="range"
                min={35}
                max={100}
                step={5}
                value={Math.round(settings.aeroChartOpacity * 100)}
                onChange={(e) =>
                  updateUiSettings({ aeroChartOpacity: Number(e.target.value) / 100 })
                }
              />
            </div>

            <div className="settings-aero-links">
              <Link id="settings-open-vfr" className="btn-primary" href="/explore/trails?basemap=vfr">
                Open 3D VFR Map
              </Link>
              <Link id="settings-open-ifr" className="btn-ghost" href="/explore/trails?basemap=ifr">
                Open 3D IFR Map
              </Link>
            </div>
            <p className="text-xs text-mist">
              FAA VFR Sectional, Terminal Area, and IFR Enroute Low/High charts are provided for 3D terrain and airspace situational reference only — not for operational flight navigation.
            </p>
          </section>
        </div>

        <aside className="settings-preview" aria-label="Live appearance preview">
          <span className="settings-preview-kicker">Live preview · Sierra airspace</span>
          <h3>Half Dome via Mist Trail</h3>
          <p>
            Granite steps beside Vernal and Nevada Falls ascending into Yosemite high country beneath Sierra MOA &amp; Class E transition airspace.
          </p>
          <dl className="settings-preview-stats">
            <div>
              <dt>Distance</dt>
              <dd>{formatDistance(14.2, units)}</dd>
            </div>
            <div>
              <dt>Climb</dt>
              <dd>{formatElevation(4800, units)}</dd>
            </div>
            <div>
              <dt>Summit</dt>
              <dd>{formatElevation(8842, units)}</dd>
            </div>
          </dl>
          <div className="settings-preview-badges">
            <span className="rounded-full border border-[var(--border-strong)] bg-surface-elevated px-2.5 py-1 text-xs font-medium text-cream">
              {activeBasemapLabel}
            </span>
            <span className="rounded-full border border-[var(--border-strong)] bg-surface-elevated px-2.5 py-1 text-xs font-medium text-sage">
              3D {settings.terrainExaggeration.toFixed(1)}× · Chart {Math.round(settings.aeroChartOpacity * 100)}%
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link className="btn-primary" href="/explore/trails">
              Explore map
            </Link>
            <Link className="btn-ghost" href="/explore/trails/catalog">
              Catalog
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
