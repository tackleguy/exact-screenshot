<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

- Keep cross-app appearance in semantic tokens and shared presentation rules in global CSS; preserve route, data, auth, and map logic during visual changes.
- Load display, body, and measurement fonts through the shared layout so all pages inherit consistent typography.
- Keep static image type references in a tracked declaration file and expose `build:dev` through the normal build script so clean preview builds retain image typing and asset preparation.
