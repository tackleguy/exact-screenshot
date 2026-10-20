# Hyked

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Unify trail discovery, maps, GPS activity recording, gear management, and packing preparation under Hyked. The user requested a new, modern, simplified interface that makes the combined apps work together.

## Users

Inferred from the existing apps: hikers and backpackers preparing trips, managing equipment, and recording outings; runners, cyclists, and skiers also use the recorder. User-confirmed primary workflow: find a trail, prepare your pack, record the outing.

## Capabilities and Constraints

The active app is the Next.js application at the repository root. Preserve existing Supabase authentication, user gear, custom trails, activity recording, trail data, and map routes. The sibling Hyked app is reference material, not the build target. A local checkout has no configured Supabase credentials; public curated route information is already available in src/lib/gear.ts. Never fabricate activity totals, weather, route maps, ratings, or personal trips. Local-only planning must be visibly identified as saved on this device; cloud persistence must not be implied.

## Brand Commitments

Hyked is the confirmed app name (renamed from Hyked at the user’s request). The user selected the Fieldbook visual mockup and requested trail coverage for Canada and the United States. The user explicitly requests modern and simple; no binding color or typography choice was supplied.

## Evidence on Hand

Existing curated routes in src/lib/gear.ts, local landscape image at public/images/splash-image.jpg, live data APIs, and prior Hyked gear and packing flows in ../exact-screenshot. Curated route figures are existing planning references, not current travel conditions.

## Product Principles

- Connect discovery, preparation, and activity recording around the outing.
- Keep essential tools equally reachable on mobile and desktop.
- Reveal detail when needed and keep one clear next action.
- Distinguish personal data, curated references, and empty states.

## Personal Trip Assistant

Confirmed: people describe a trip such as “30 miles, 3 days in Colorado” and receive trail options, a pack calculation, and packing guidance informed by their own equipment and prior outings. The assistant runs in the browser with no separate installation; a future native app can bundle the model. Online product and trail research is allowed with source links. Browser model files load on explicit activation and are cached locally. The current implementation uses only the signed-in account, with separate guest memory; cross-account learning and external account connections are not authorized.

The local model prioritizes validated plan insights through constrained structured output. Unit conversion, weight totals, and source specifications are deterministic, preventing generated numerical claims. Preferences, supplemental gear, saved plans, and completed-trip feedback persist in browser storage scoped by account. These are not cloud-synced. Route matching and calculations work before the model loads or on browsers without WebGPU.
