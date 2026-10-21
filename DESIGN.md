---
name: "Hyked Mountain Night"
description: "Restored dark outdoor appearance; the original Fieldbook record below is historical."
colors:
  background: "#141814"
  foreground: "#ece8df"
  surface: "#1e241e"
  surface-muted: "#323a32"
  accent: "#c8f04a"
  accent-dim: "#b4dc3f"
  pine-light: "#36745b"
  sage: "#59665e"
  border: "#d9e1d9"
  border-strong: "#c4cfc5"
  rail-hover: "#244d40"
  rail-active: "#315c4d"
  rail-text: "#c4d7ca"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(28px, 3vw, 40px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  field: "6px"
  control: "8px"
  container: "12px"
  large: "16px"
spacing:
  xs: "8px"
  small: "12px"
  field: "16px"
  compact: "20px"
  panel: "24px"
  section: "32px"
  workspace: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 12px"
  navigation-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.sage}"
    rounded: "{rounded.field}"
    padding: "6px 12px"
  context-panel:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "24px"
---

# Design System: Hyked Mountain Night

## Current appearance

The user requested restoration of the old dark outdoor UI. Shared global CSS is authoritative: forest-charcoal surfaces, warm cream text, lime actions, Playfair Display headings, DM Sans body text, and JetBrains Mono measurements. Desktop navigation is a horizontal glass header; mobile retains all five destinations and More tools. Routes, catalog sources, saved gear, trip planning, recording, and account logic are unchanged.

Generated alpine dusk imagery is atmospheric illustration only, never a photo of a selected trail. It lives at `src/assets/mountain-night.jpg`, imported through the shared layout and public home. Keep source labels and unknown-weight states visible. The Fieldbook documentation below is a historical record, superseded wherever it conflicts with this section.

## Overview

**Creative North Star: "Fieldbook"**

Fieldbook connects real trail sections to personal routes, gear, and recording. A light mineral workspace and evergreen navigation give the task a steady frame; Inter, ruled lists, and green actions keep preparation legible and direct. The approved Fieldbook world is implemented in the application.

This record captures the source in `src/app/globals.css`, `src/app/layout.tsx`, shared navigation, catalog, planner, activity log, recording handoff, and guest gear. The approved Figma file is `TXdEs8S62B0WxXXLJqovWc`; saved verified desktop renders and construction definitions in `.impeccable/figma/` guided implementation when the connector quota blocked fresh context. Surface-specific composition lives in `.impeccable/surfaces/`. Figma prototype and unverified mobile frames remain separate work.

**Key Characteristics:**
- Mineral ground, white work areas, and sage context panels.
- Evergreen navigation and restrained forest actions.
- Sans-serif hierarchy, tabular measurements, and ruled information.
- One connected sequence from discovery to preparation to recording.

## Colors

The palette uses quiet green neutrals to frame real information. Frontmatter owns the production values; synthesized sidecar ramps are preview aids, not extra application tokens.

### Primary

- **Forest action** (`accent`): primary actions, links, active steps, progress, and focus outlines.
- **Evergreen** (`accent-dim`): navigation rail and primary-action hover.
- **Lighter pine** (`pine-light`): inherited semantic accent variation.
- **Rail hover, active, and text** (`rail-hover`, `rail-active`, `rail-text`): distinct navigation states on evergreen.

### Neutral

- **Mineral** (`background`): the page ground.
- **White workspace** (`surface`): task panes, fields, and secondary buttons.
- **Sage wash** (`surface-muted`): contextual summaries and quiet selection surfaces.
- **Charcoal green** (`foreground`): headings and primary information. Legacy `cream` utilities resolve to this same value in the light shell.
- **Muted sage** (`sage`): supporting text and units. Legacy `mist` uses the same value.
- **Soft and strong rules** (`border`, `border-strong`): separators, control boundaries, and structured data rows.

**The Text Carries State Rule.** Selection, incomplete weights, save state, and model availability are written in text; color reinforces them.

The active GPS route `/record/live` intentionally uses a dark instrument palette scoped by AppShell. Its dark background, cream text, and lime controls are a recording exception; these tokens must not leak into planning.

## Typography

**Display Font:** Inter with sans-serif fallback.

**Body Font:** Inter with sans-serif fallback.

Inter carries every hierarchy level. Headings are semibold, sentence case, and compact; operational copy remains regular. Use the frontmatter hierarchy as the shared baseline. Planner body text is (14px), catalog supporting text is (14–16px), and small labels are (12–13px). Shared mobile page headings use (30px); planner mobile headings use (28px). Planner heading line height is (1.15), catalog/shared page headings (1.2).

**The Measured Numbers Rule.** Distances, pack weights, and inventory counts use tabular numerals; units remain visually secondary.

## Layout

Desktop uses a fixed evergreen rail (240px) with a workspace inset of (48px) at the left and (32px) at the right. Workspaces cap at (1500px). Between (768px) and (1199px), the rail narrows to (208px), and shared/catalog workspace side padding becomes (32px). Planner side padding becomes (24px) at its (1100px) breakpoint.

Catalog, planning, and activity-log workspaces pair the main task with a supporting column: `minmax(0, 1.87fr) minmax(290px, 1fr)`, separated by (24px). The catalog uses a fixed (290px) supporting column below (1200px); planner uses it at (1100px), with a (20px) gap. At (1000px) and below, these workspaces stack in document order. Planner adopts (20px) side padding at that point.

Below (768px), the rail becomes an evergreen mobile header and a four-destination bottom navigation. Content reserves (80px) below for navigation, with safe-area padding in the bar. Mobile pages use (20px) side padding. Login, signup, and active GPS recording use standalone shells without the normal rail or bottom navigation. The shared spacing vocabulary emphasizes (8px), (12px), (16px), (20px), (24px), (32px), and (48px).

## Elevation & Depth

The workspace is flat. White task panes, tinted context, and thin rules establish depth without decorative lift, glass, or gradients. The mobile More tools overlay alone uses the navigation shadow (`0 8px 24px #173f3526`); map marker labels have their own small legibility shadow.

**The Quiet Surface Rule.** Use tonal separation and rules for ordinary task structure; reserve shadow for overlays and map labels.

State changes use short background transitions (160ms ease-out); planner buttons use (150ms). Reduced-motion preferences disable or effectively eliminate animation and transitions.

## Shapes

Controls and principal task/context panes use modest corners (8px). Shared legacy containers and map canvases retain (12px), while planner text fields and shared chips use (6px). Numbered step indicators and map dots are circular. Keep lists ruled and open rather than turning every item into a separate card.

## Components

### Buttons

Primary buttons use forest with white text and an evergreen hover. Shared buttons have a minimum height of (44px); prominent catalog/planner actions use (48px). Secondary actions sit on white with a visible neutral border. Focus uses a (2px) accent outline, normally offset (4px); catalog links/buttons use (5px). Disabled controls preserve their native semantics.

### Inputs / Fields

White, bordered fields pair visible labels with muted hints. Catalog controls are (44px) tall with (8px) corners; planner fields use (6px) corners and (11px 12px) padding. Planner fields enlarge to (16px) below its (1000px) breakpoint. The trip request is a large borderless Inter textarea inside the white workspace.

### Navigation

Explore, My trips, and Gear are the primary destinations. More tools discloses recording, map, activity log, route guides, custom trails, ski resorts, and search. Desktop recording and profile links remain reachable at the rail foot. Mobile uses Explore, My trips, Gear, and Profile in the bottom bar; More tools stays in the header. Active destinations combine a tonal background, stronger text, and `aria-current`. A skip link precedes the content.

### Chips

Compact bordered chips use white and muted sage; selected chips gain the sage surface, forest text, and a forest border. Their role is concise state or filtering, not primary navigation.

### Cards / Containers

White workspaces and sage context panes have (24px) internal padding, reducing to (20px) on narrow layouts. The context column supports the current task instead of introducing a competing dashboard. Empty states give a concrete next action without invented activity totals or personal data.

### Ruled trail rows

Names, source/location context, and right-aligned section distances form readable rows. Explore opens with a four-record preview; More trails continues to the ordinary (24-record) result page while retaining filters. Map disclosure uses actual catalog geometry. The source explanation identifies records as sections, not complete hikes.

### Trip preparation

Numbered stages read Choose a trail → Prepare your pack → Record your outing. A white checklist workspace and sage pack summary retain the same trip context. The weight summary explicitly identifies incomplete totals; Review & record and Download checklist precede detailed carrying guidance. Saved-device and unsaved-change messages are visible.

The shallow landscape banner is a CSS crop of `public/images/fieldbook/planning-landscape.png`, the approved generated Fieldbook composition. It carries embedded provenance and an adjacent `.provenance.json` file. Visible and accessible labels identify a planning illustration; it is never evidence of the selected route's appearance.

### Trail map (`/map`)

The trail map is the second scoped exception to the light workspace, after `/record/live`. It is full-bleed under the evergreen rail, with dark floating chrome so controls read over topo, satellite and 3D terrain alike. Its tokens live in `src/components/explore/explorer.css` and must not leak into planning pages.

- **Ink chrome** (`#10201a`, hover `#1a2e26`): search, filter chips, map controls, trail cards and popovers. Text `#f4f2ec`, supporting text `#b6c3ba`.
- **Trail highlight** (`#ffc21a`): the selected trail line, the active card outline, the primary card action, focus rings and the 3D/active control state.
- **Difficulty colours** (pins, lines, legend, card badges): easy `#2f9e5b`, moderate `#2f7fd8`, hard `#d8452f`, expert `#1d1d1d`. Lines carry a dark casing so they hold on every basemap.
- **OpenStreetMap paths** from OpenTrailMap tiles are fine dashed topo lines (`#8c4a32`), never the access colours of the upstream style.
- **Shapes:** search and filter chips are full pills (999px); controls and cards use 12–14px corners. Shadows are soft and offset (`0 6px 20px`), reserved for floating chrome.
- **Type:** Inter at 12–15.5px with tabular numerals; card names 15.5px semibold.
- **Behaviour:** the card rail lists trails in view nearest first (short stubs rank lower). Selecting a pin, line or card loads the full line, elevation profile, today’s forecast and directions (in-map drive route, Google Maps, Apple Maps). Sections (Hike & walk, Bike, Horseback, Snow) open on the visitor’s sign-up choice.

## Do's and Don'ts

### Do:
- Do use the shared mineral, evergreen, and Inter system for planning surfaces.
- Do preserve source attribution, missing-data labels, and explicit local-save status.
- Do keep discovery, gear preparation, and recording connected through clear actions.
- Do retain visible keyboard focus, semantic current states, and reduced-motion support.
- Do label generated scenery as an illustration and keep its provenance with the asset.

### Don't:
- Don't restore the discarded dark planning palette or serif headings.
- Don't fabricate trip history, ratings, gear weights, route completeness, or current conditions.
- Don't imply browser-local plans are cloud-synced or mix guest and account memories.
- Don't spread the active GPS instrument theme into the light workspace.
