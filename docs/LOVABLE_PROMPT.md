# Lovable prompt — Hyked frontend

Paste everything below the line into Lovable as the first message of a new project. Before you do:

1. Deploy this repo (the backend) and note its URL, e.g. `https://hyked-api.vercel.app`.
2. Run the Supabase migrations in `supabase/migrations/` on your Supabase project (the newest adds `saved_trips`, `favorite_trails`, `catalog_trail_reviews`).
3. In Lovable, connect the same Supabase project, and add the environment variable `VITE_HYKED_API_URL` with the backend URL.

When the backend changes later, tell Lovable: “Pull the latest API changes from docs/API.md in github.com/tackleguy/health and update the frontend to match.” Paste the updated `docs/API.md` if Lovable can’t read the repository.

---

Build **Hyked**, a hiking app for finding real trails, planning multi-day trips (water, resupply towns, gear) and taking the plan offline. The app is a frontend only: all trail data comes from the existing Hyked REST API, and accounts and personal data use Supabase.

## Stack and setup
- Vite + React + TypeScript + Tailwind + shadcn/ui, React Router, TanStack Query for all API calls.
- `const API = import.meta.env.VITE_HYKED_API_URL` (no trailing slash). Every trail request goes to `${API}/api/...`. Trail ids contain characters like `{` `}`: always `encodeURIComponent(id)` in paths and use the id from the API as-is in your own routes (`/trail/:id`).
- Maps: MapLibre GL JS. Basemap style: `${API}/opentrailmap/styles/otm-foot.json` (set the style's `sprite` to the absolute URL `${API}/opentrailmap/sprites/opentrailmap` after fetching it). If that fails, fall back to `https://tiles.openfreemap.org/styles/liberty`. Trail lines come from the API as `[lng, lat][][]`.
- Supabase (connected project) for auth and user data only. Tables: `profiles(id, first_name, last_name, brief_bio, avatar_url)`, `gear_items(user_id, name, category, type: Base|Worn|Consumable, qty, weight (oz), price, link)`, `saved_trips(user_id, catalog_trail_id, name, days, start_date, max_carry_days, plan jsonb, pack jsonb, notes)`, `favorite_trails(user_id, catalog_trail_id)`, `catalog_trail_reviews(user_id, catalog_trail_id, rating 1–5, difficulty, body, hiked_on)`, `activities(user_id, activity_type run|hike|bike|ski, title, distance_m, duration_sec, elevation_gain_ft, route_geojson, catalog_trail_id, started_at, ended_at, notes)`. Row-level security already limits rows to their owner.

## API (full reference: docs/API.md in the backend repo)
- `GET /api/trail-catalog?q=&region=&activity=hike&minMiles=&maxMiles=&difficulty=&lat=&lng=&radiusKm=&bbox=&resort=&page=&limit=24` → `{ trails, total, page, pages }`
- `GET /api/trail-catalog/map?<same filters>` → `{ points: { id, latitude, longitude, count, bounds?, trail? }[], grouped }` (clusters when `count > 1`)
- `GET /api/trail-catalog/{id}` → `{ trail, lines }`
- `GET /api/trail-catalog/{id}/elevation` → `{ profile: [mile, ft][], gainFt, lossFt, minFt, maxFt }`
- `GET /api/trail-catalog/{id}/water` → `{ sources: { kind, name, mile, offTrailMeters, crossing, reliability: potable|treat|seasonal, latitude, longitude }[], longestDryMiles, notes, attribution }`
- `GET /api/trail-catalog/{id}/towns` → `{ towns: { name, state, trailMile, milesOffTrail, population, services: { counts: { grocery, outfitter, post, lodging, campground, laundry, fuel, food, pharmacy, medical, money, library }, places } }[], attribution }`
- `GET /api/trail-catalog/{id}/town-days?days=&startDate=&maxCarryDays=5` → `{ milesPerDay, startFoodDays, startFoodLb, stops: { town, arriveDay, date, trailMile, foodDays, foodLb, checklist: string[], warnings: string[] }[], gaps: { fromMile, toMile, days }[], notes }` (422 with a readable `error` when a trail can’t be planned)
- `GET /api/trail-catalog/{id}/download?format=gpx|csv|html|json&days=…` → files; `POST /api/trips/packet` with `{ trailId, format: "html", days, startDate, maxCarryDays, pack: [{ name, quantity, weightOz, category, consumable }] }` → printable HTML packet (open in a new tab)
- `GET /api/trail-catalog/{id}/photos`, `GET /api/weather/forecast?lat=&lng=`, `GET /api/directions?from=lat,lng&to=lat,lng`, `GET /api/assistant/places?q=`, `GET /api/resorts`, `GET /api/meta`
- Errors are `{ error }` with a message safe to show. Water, towns and town days can take several seconds the first time: show skeletons, never block the page.

Key trail fields: `name, region, country, miles, kind (segment|route), difficulty, routeType (loop|point-to-point|network), trailType, trailStatus (OPEN|CLOSED|SEASONAL|RESTRICTED|UNKNOWN), confidence (VERIFIED|OFFICIAL_GEOMETRY_VERIFIED|NEEDS_REVIEW|REJECTED), sourceType, park, forest, blmArea, skiResort, officialTrailId, uses[], trailhead {name, latitude, longitude, water, closestTowns}, elevationFt {min,max}, flags[], note, sourceUrl, officialUrl, sources[]`.

## Screens
1. **Home** — full-bleed photo hero with “Find, plan and pack your next hike.” and one big search field (trail, park or town) with suggestions from `/api/trail-catalog?q=`; quick chips (Near me, Day hikes under 5 mi, Backpacking, Ski resort summer hikes, Through-hikes); a row of featured trails; a short “How Hyked works” strip (Find → Plan water & town days → Pack → Download). Signed-in users also see recent activities and saved trips.
2. **Explore** — split view on desktop (list left, map right), list/map toggle on mobile. Filters in a sheet: distance range, difficulty, activity, region, “near me”. Map pins/clusters from `/map`; selecting a pin shows a card and draws the trail line. Result cards: name, place (park/forest/resort/state), distance, difficulty, route type, confidence badge.
3. **Trail page** — hero (name, place, distance in mi and km, difficulty, route type, status badge; “Closed”/“Seasonal” warnings prominent), big map with the line, water drops and town pins, elevation chart (gain/loss), tabs: **Overview** (facts, source and official links, trail number, allowed uses, trailhead with “Open in Google Maps” and “Directions”), **Water** (list by mile with potable/treat/seasonal badges and the longest dry stretch), **Towns** (cards with service icons), **Town days** (form: days, start date, max carry days → day-by-day stops with checklists and warnings), **Weather** (7-day), **Photos**, **Reviews** (Supabase). Actions: Save trip, Favorite, Download (GPX, water CSV, printable packet), Plan this trip.
4. **Plan a trip** — stepper: choose trail → days/start date → pack (pick from the user’s `gear_items`, show base/worn/consumable weights) → town days (from the API) → review & download packet (POST `/api/trips/packet` with the pack) → save to `saved_trips`.
5. **Gear locker** — CRUD on `gear_items` grouped by category with weight totals; guests use localStorage.
6. **Trips** — saved trips and favorites; each opens its plan and packet.
7. **Resorts** — `/api/resorts` list with map; each resort shows its summer hiking trails (`?resort=` search). These trails have no route line: show the resort pin and say “Route not published by the resort”.
8. **Record / Activity log** — list and detail of `activities`; manual entry form. (GPS recording can be a later phase.)
9. **Auth** — Supabase email sign-in/up, profile page.

## Design (make it feel like a premium outdoor brand)
- Name and wordmark: **Hyked** (lowercase “hyked” wordmark is fine), a simple mountain-and-path mark.
- Palette: forest `#1F4D3A` (primary), pine `#2F6B4F`, moss `#7FA36B`, sand `#F3EFE6` (background), stone `#5D6B62` (muted text), sky `#3B82F6` for water, amber `#C9822B` for warnings, red `#B42318` for closures. Dark mode with deep green-charcoal surfaces.
- Type: “Inter” for UI, “Fraunces” (or another characterful serif) for page titles. Large, confident headings; generous spacing; 12–16 px radii; soft shadows; plenty of white space.
- Mobile-first: bottom tab bar (Explore, Plan, Trips, Gear, Profile), sticky action bar on the trail page, thumb-friendly controls. Desktop: left sidebar or top nav.
- Meaningful icons (lucide): droplet for water, store for groceries, mail for post office, bed for lodging, fuel, washing machine for laundry, mountain for elevation.
- Skeleton loaders, empty states with a next step, toasts for saves, accessible contrast, keyboard focus states, `prefers-reduced-motion`.

## Data honesty rules (important)
- Never invent trail names, distances, coordinates, water or town details. Show only what the API returns, and say “Not reported” for missing values.
- Always show source attribution strings the API returns (water, towns, elevation) and link to `sourceUrl`/`officialUrl`.
- Show `confidence` as a small badge (“Official — verified”, “Verified”, “Needs review”) and display the API’s warnings (`flags`, `note`, town `warnings`, water `notes`) near the data they describe.
- Directions and trailheads are for planning; remind users to confirm access, closures and permits with the land manager.
