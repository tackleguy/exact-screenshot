# Lovable publishing

The Lovable preview runs the React client in `src/web` with Vite. `bun run build` and `bun run build:dev` prepare the map worker assets and write the static website to the root `dist/` directory. Client-side routing supports page refreshes on Lovable hosting.

The existing Next.js API and reference pages remain in place. Use `bun run dev:server` locally and `bun run build:server` for server hosting. `vercel.json` selects that server build explicitly.

## Live trail services

Set `VITE_HYKED_API_URL` to the actual HTTPS origin of the separately deployed Next.js service before publishing. No production API origin was configured when this client was added. Until one is supplied, live catalog searches, trail lines, directions previews, weather, nearby services, and product research report unavailable instead of returning mock data. Server-specific park and administrative pages link to that host when configured.

The hosted service must allow the frontend origin in its CORS configuration. Public catalog requests are forwarded only to the configured origin. API links and downloads use that origin too.

Accounts and personal gear use the existing browser account client directly. Only public account settings are included in the frontend; server secrets are not bundled. Activity reads and recording saves use the account client with the signed-in user's identity and existing database policies, rather than relying on cookies from a different site.

## Verification

Run `bunx tsx --test src/web/api-target.test.ts` for API URL routing regressions. The normal Lovable build validates the static artifact; do not treat `.next/` as a deployable static website or rename it to `dist/`.