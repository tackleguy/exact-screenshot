---
name: "Hyked Fieldbook planner"
description: "The implemented light trip planner, pack checklist, and guest equipment patterns."
colors:
  background: "#f6f7f4"
  foreground: "#18251f"
  surface: "#ffffff"
  surface-muted: "#e9efe9"
  accent: "#245b47"
  accent-dim: "#173f35"
  sage: "#59665e"
  border: "#d9e1d9"
  warning: "#8b4415"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(28px, 3vw, 40px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
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
  request:
    fontFamily: "Inter, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  field: "6px"
  control: "8px"
  circle: "50%"
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
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  context-panel:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
  workspace:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "24px"
  step-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.circle}"
    size: "32px"
---

# Design System: Hyked Fieldbook planner

## Overview

**Creative North Star: "Fieldbook"**

The planner implements the approved Fieldbook world as a personal preparation workspace: a mineral page, white task pane, sage context, and clear forest actions. Inter replaces the previous serif typography. Its three numbered stages connect route choice, personal gear, and recording.

This scoped record covers `TripPlanner.tsx`, `planner.css`, GearEditor, ProductLookup, and the guest Gear surface that reuses the planner styles. The root `DESIGN.md` is the shared visual authority. Surface behavior is recorded in `.impeccable/surfaces/src-app-plan-page-tsx.md` at the project root.

**Key Characteristics:**
- White task workspace with a sage pack and memory sidebar.
- Numbered stages and persistent trip context.
- Ruled gear rows, tabular weights, and explicit incomplete totals.
- Device-save status and optional model controls disclosed in place.

## Colors

### Primary

- **Forest action** (`accent`): buttons, links, current step, checkboxes, progress, and focus.
- **Evergreen hover** (`accent-dim`): primary-action hover; the shared rail belongs to the root system.

### Neutral

- **Mineral** (`background`), **white workspace** (`surface`), and **sage wash** (`surface-muted`): page, task, and supporting context.
- **Charcoal green** (`foreground`): main text; the legacy `cream` utility resolves to the same foreground.
- **Muted sage** (`sage`): help, units, save status, and local-model information. Planner muted and line aliases resolve to the shared sage and border tokens.
- **Soft rule** (`border`): rows, fields, disclosures, and summary breakdowns.

### Status

- **Warm warning** (`warning`): missing weights and incomplete data, always accompanied by text.

**The Text Carries State Rule.** Missing weights, unsaved edits, local persistence, and model status are stated explicitly.

## Typography

**Display Font:** Inter with sans-serif fallback.

**Body Font:** Inter with sans-serif fallback.

The large trip request uses (26px) Inter at weight (500) and line height (1.35), reducing to (23px) on mobile. Route names use (24px) semibold; the route-results heading is deliberately smaller at (18px), placing the actual route first. The main heading uses the responsive frontmatter size and reduces to (28px) below (768px). Stage headings use (24px), reducing to (22px) on mobile. Body copy is (14px); hints are (13px). Standard form fields become (16px) at (1000px) and below.

**The Measured Numbers Rule.** Pack totals, route statistics, numeric inputs, and memory counts use tabular numerals.

## Layout

The shell caps at (1500px), with final top padding (24px), left inset (48px), right inset (32px), and bottom padding (64px). The desktop workspace uses `minmax(0, 1.87fr) minmax(290px, 1fr)` and a (24px) gap. At (1100px), side padding becomes (24px), the supporting column (290px), and the gap (20px). At (1000px), columns stack and the shell uses (20px) side padding. Mobile shell padding is (24px 20px 40px).

Task and context panes use (24px) padding and (8px) corners, reducing to (20px) padding below (768px). Numbered stages remain a row; mobile puts each number above its label. On a selected route, the illustrated banner precedes the stages, with actual route distance, requested days, and chosen or undecided dates below it. The banner is (222px) high on desktop and (180px) on mobile.

Packing handoff and checklist-export actions appear directly after the summary weight breakdown. Detailed guidance follows. Gear rows and checkbox labels wrap on mobile, with secondary details below the item rather than pushing the workspace wider.

## Elevation & Depth

White workspace and sage sidebar establish depth without shadows. Rules separate equipment, disclosures, and weight rows. Primary buttons transition background over (150ms); reduced motion disables transitions and animation. Focus is a (2px) forest outline offset (4px); focused stage headings use a (6px) offset.

## Shapes

Task panes, buttons, and banner use (8px) corners. Standard fields retain (6px); the large request textarea is borderless and square. Current-stage numbers occupy (32px) circles, reducing to (28px) on mobile. Checkboxes use native semantics and the forest accent.

## Components

### Buttons

Forest primary buttons have white text, (48px) minimum height, (11px 18px) padding, and weight (650). White secondary buttons use charcoal text and a neutral border. Links remain forest and gain an underline on hover. Generic disabled buttons dim; unavailable stage buttons retain readable text and disabled semantics.

### Inputs / Fields

White fields use a soft border, muted placeholders, and a visible label. The prompt textarea has a (140px) minimum height; its example and Build my trip controls sit below a rule. Trip details, supplies, equipment editing, preferences, source research, and model controls use native disclosures.

### Navigation

Choose a trail → Prepare your pack → Record your outing uses numbered circles, `aria-current="step"`, and programmatic focus on the stage heading after changes. Inactive steps use sage numbers; the current step is forest with a white numeral.

### Cards / Containers

The task pane is white and the supporting pack/memory pane is sage. The summary displays known gear, worn items, consumables, and missing inputs distinctly. Its dominant total is (32px); it never silently substitutes a complete pack weight for an incomplete one.

### Packing rows and saved plans

The grouped checklist tracks packed state and progress. Inline equipment editing, restored plans, saved-plan updates, and visible Unsaved changes/Saved on this device status keep preparation reviewable. Guest Gear uses the same guest storage as the planner; signed-in account memories remain separate. Optional model activation and download state stay disclosed; deterministic parsing, matching, and arithmetic work without the model.

### Planning illustration

The banner crops the original approved generated composition at `public/images/fieldbook/planning-landscape.png`. Visible text says Planning illustration; accessible text explicitly distinguishes it from a route photograph. Keep the embedded and adjacent provenance intact. Do not substitute generated scenery as a factual route preview.

## Do's and Don'ts

### Do:
- Do place the route name before difficulty and distance-to-target metadata.
- Do keep the pack summary and recording/export actions prominent.
- Do disclose missing weights and identify browser-local save state.
- Do preserve separate guest and account memory scopes.
- Do keep optional model activation explicit and the ordinary planner usable without it.

### Don't:
- Don't bring back forest planning backgrounds, lime buttons, or Playfair headings.
- Don't invent equipment weights, trip history, or current route conditions.
- Don't claim that preparing a checklist export confirms a file was delivered.
- Don't label the generated landscape as a photograph of the selected trail.
