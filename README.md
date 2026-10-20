# Hyked

Hyked helps hikers find real trails, plan multi-day trips (water, resupply towns, gear) and take the plan with them. This repository is the **Hyked backend and reference web app**: a Next.js app whose `/api/*` routes are a public JSON API. The new Hyked frontend is built in Lovable on top of that API and the same Supabase project.

- **API reference:** [docs/API.md](docs/API.md) — trails, maps, elevation, water sources, towns and services, town-day resupply plans, downloads (GPX, CSV, printable trip packet), directions, weather.
- **Lovable prompt:** [docs/LOVABLE_PROMPT.md](docs/LOVABLE_PROMPT.md) — paste into Lovable to build the frontend; it also explains how to pull later API changes.
- **Trail catalog:** about 146,000 whole trails from USGS, the National Park Service, U.S. Forest Service, BLM, Parks Canada, the Ontario Trail Network and ski resorts' official pages, each with its source, confidence and quality checks. See [catalog sources, licenses and refresh instructions](data/trail-catalog/README.md).

The catalog, API and guest planner work without Supabase. Accounts, gear, saved trips and activities need the configuration below. Set `CORS_ORIGINS` to restrict which sites may call the API (default: any), and `ROUTING_API_URL` to your own OSRM server for production driving directions.

Trail data platform (Phase 1): PostGIS geometry, ingestion pipeline, spatial APIs, admin dashboard.
**Full documentation:** [docs/TRAIL_PLATFORM.md](docs/TRAIL_PLATFORM.md)

## Local dev

```bash
npm install
cp .env.local.example .env.local   # add Supabase keys + ADMIN_SECRET
npm run dev
```

Apply Supabase migrations (includes PostGIS schema + sample trail geometries):

```bash
supabase db reset   # or supabase migration up
```

## Vercel

1. **Root Directory:** leave **empty** (repo root)
2. **Install / Build commands:** leave default (`npm install`, `next build`)
3. **Environment variables:**
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ADMIN_SECRET` (for `/admin`)

Add your Vercel URL to Supabase Auth redirect allowlist.
