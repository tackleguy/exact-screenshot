---
name: "Hyked Fieldbook catalog"
description: "Source-attributed trail discovery in the approved light Fieldbook workspace."
colors:
  background: "#f6f7f4"
  foreground: "#18251f"
  surface: "#ffffff"
  surface-muted: "#e9efe9"
  accent: "#245b47"
  accent-dim: "#173f35"
  sage: "#59665e"
  border: "#d9e1d9"
  border-strong: "#c4cfc5"
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
  row: "4px"
  control: "8px"
  map: "12px"
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
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "10px 20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 12px"
  context-panel:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "24px"
  trail-row:
    textColor: "{colors.foreground}"
    rounded: "{rounded.row}"
    padding: "24px 0"
---

# Design System: Hyked Fieldbook catalog

## Overview

**Creative North Star: "Fieldbook"**

Explore brings public trail sections into the approved light Fieldbook workspace. A compact search area leads to four ruled results and a personal-planning invitation, keeping the next step visible without overstating the catalog as complete hikes.

This record covers `CatalogBrowser.tsx`, `CatalogMap.tsx`, and `catalog.css`, inheriting the root `DESIGN.md`. The project-root brief `.impeccable/surfaces/src-app-explore-trails-page-tsx.md` records the discovery strategy. The saved Figma desktop Explore render is the visual reference; the production data and CSS are authoritative for actual states and responsive behavior.

**Key Characteristics:**
- Mineral workspace, forest actions, and an evergreen shared shell.
- Four-row first view with filter-preserving continuation.
- Ruled results with source context and tabular section distances.
- Sage planning context and optional real-geometry maps.

## Colors

### Primary

- **Forest action** (`accent`) and **evergreen hover** (`accent-dim`): actions, links, focus, and row chevrons.

### Neutral

- **Mineral** (`background`): catalog ground.
- **White** (`surface`): inputs, secondary actions, example request, and row hover.
- **Sage wash** (`surface-muted`): planning context.
- **Charcoal green** (`foreground`) and **muted sage** (`sage`): result names, source lines, hints, and distance units.
- **Soft and strong rules** (`border`, `border-strong`): controls, source summary, and result separators.

**The Source Stays Visible Rule.** Source and section meaning remain adjacent to each trail result and available in the coverage disclosure.

Map labels retain local map-specific colors for legibility; these are not a replacement palette for the workspace. Sidecar ramps are synthesized preview aids only.

## Typography

**Display Font:** Inter with sans-serif fallback.

**Body Font:** Inter with sans-serif fallback.

The main heading uses the shared responsive display role. Result titles use (18px), weight (600), line height (1.45); below (1200px), they use (16px). Supporting source/location lines use (14px), reducing to (12px) on mobile. Distances are (18px) semibold on desktop, (16px) at intermediate widths, and (15px) on mobile. Units stay smaller. The planning heading uses (24px), line height (1.3), and tracking (-0.02em).

**The Measured Numbers Rule.** Section distances, counts, and detail facts use tabular numerals.

## Layout

The shell caps at (1500px), with (32px) top, (48px) left, (32px) right, and (64px) bottom padding. Search and its submit button share one row at every width, with a flexible input, an intrinsic-width action, and a (12px) gap. The native Filters disclosure follows on a (44px) minimum-height summary row; applied location and distance values remain visible beside its label. The expanded panel groups country, region, minimum miles, and maximum miles in four columns, becoming two below (1200px). Side padding becomes (32px).

A results toolbar precedes `minmax(0, 1.87fr) minmax(290px, 1fr)` columns with a (24px) gap. The sage planning column is sticky (24px from the top) on larger screens. Below (1200px), it becomes (290px) wide. At (1000px) and below, it follows results in normal document order; a visible planning link also appears near the introduction.

Below (768px), shell padding is (24px 20px 40px), the search gap is (8px), and the filter panel uses (16px) padding with its hint and Apply filters button stacked. Rows retain names/context on the left and distances on the right, using a fixed (88px) distance column. Chevrons disappear, the toolbar stacks, and labels wrap naturally. The initial result set contains four records; More trails changes the limit to (24) while retaining filters. Source explanation follows the preview. Detailed trail pages retain their two-column content until the (560px) breakpoint.

## Elevation & Depth

Flat mineral ground, white row hover, thin result rules, and sage context create hierarchy. The map canvas clips to (12px) corners; its marker labels alone use `0 2px 5px #0003` for geographic legibility. Result hover uses (160ms ease-out), disabled by reduced-motion preference.

## Shapes

Catalog buttons and fields use (8px) corners. The context and example request use the same radius; result hover has subtle (4px) corners while rules remain the structural boundary. Map dots are circular and label chips use (4px) corners.

## Components

### Buttons

Forest primary actions have white text, a (48px) minimum height, and (20px) horizontal padding. The search action matches its input at (52px) high. Secondary continuation actions use white, forest text, and a soft border. Hover darkens primary actions; keyboard focus is a (2px) forest outline offset (5px).

### Inputs / Fields

The white search field is (52px) high with an inset search icon, a visually hidden accessible label, and (16px) text. The Filters disclosure holds visibly labeled (44px) location and distance controls with (8px) corners and (12px) horizontal padding. Country and region stay paired at narrow widths. Its panel uses sage wash and (20px) padding, reducing to (16px) on mobile. The active-filter summary and section-distance hint use (13px) text. Search and Apply filters submit the same native GET form; closed disclosure fields retain their values. Clear filters appears only when a query or these filters are active. Focus uses a (2px) forest outline offset (2px) on inputs and (5px) on the disclosure.

### Navigation

The shared rail and mobile destinations come from the root system. Catalog pagination explicitly displays the current record range and page; Previous and Next preserve the selected page size and filters. The map opens by default above the results whenever matches exist. Hide map in the results toolbar collapses it; Map view reopens it. Empty results omit the map and its toggle.

### Cards / Containers

The sage planning aside has (24px) padding, reducing to (20px) below (1200px). Its white example request is explicitly labeled. The primary action carries the example request into the actual planner. Source coverage sits beneath results in a separate ruled section.

### Trail row and map

A row presents a real record name, region, source, optional source difficulty, and section distance. Geometry-estimated distances are labeled. Each row opens the detail page; the map uses actual returned catalog geometries and shows source section extent, not a fabricated complete route. Empty search results offer broader search and a reset action.

## Do's and Don'ts

### Do:
- Do retain the compact four-record first view and filter-preserving continuation.
- Do keep source attribution and the merged-trail explanation (sections joined, overlaps counted once) visible.
- Do label estimated section distance and use actual source geometry.
- Do preserve paired mobile location filters and aligned distances.

### Don't:
- Don't restore dark catalog backgrounds, lime actions, or serif titles.
- Don't present merged mapped trails as verified complete routes; coverage gaps are possible.
- Don't invent route photos, ratings, elevations, or current conditions.
- Don't turn every trail row into a raised card.
