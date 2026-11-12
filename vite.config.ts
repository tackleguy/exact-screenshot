import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function trailStaticAssetsPlugin(root: string): Plugin {
  const publicDir = path.join(root, "public");
  const distDir = path.join(root, "dist");
  let ensured = false;
  const ensurePrepared = () => {
    if (ensured) return;
    ensured = true;
    const mapReady = fs.existsSync(path.join(publicDir, "maplibre"));
    const trailsReady = fs.existsSync(path.join(publicDir, "trail-data", "current.json"));
    if (!mapReady) {
      execFileSync(process.execPath, [path.join(root, "scripts/prepare-map-assets.mjs")], { cwd: root, stdio: "inherit" });
    }
    if (!trailsReady) {
      const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
      if (fs.existsSync(tsxCli)) {
        execFileSync(process.execPath, [tsxCli, path.join(root, "scripts/prepare-trail-assets.ts"), "--if-ready"], { cwd: root, stdio: "inherit" });
      }
    }
  };
  const makeMiddleware = (baseDirs: string[]) => (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
    const rawUrl = req.url?.split("?")[0] ?? "";
    if (!rawUrl.startsWith("/trail-data/") && !rawUrl.startsWith("/maplibre/")) {
      next();
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawUrl);
    } catch {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }
    for (const base of baseDirs) {
      const full = path.resolve(base, "." + decoded);
      if (!full.startsWith(base + path.sep)) continue;
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        const ext = path.extname(full).toLowerCase();
        const type =
          ext === ".mjs" || ext === ".js" ? "text/javascript; charset=utf-8" :
          ext === ".json" ? "application/json; charset=utf-8" :
          ext === ".gz" ? "application/gzip" :
          "application/octet-stream";
        res.statusCode = 200;
        res.setHeader("Content-Type", type);
        res.setHeader("Content-Length", st.size);
        res.setHeader("Cache-Control", rawUrl.endsWith("/current.json") ? "no-cache" : "public, max-age=300");
        if (req.method === "HEAD") { res.end(); return; }
        fs.createReadStream(full).pipe(res);
        return;
      } catch {
        // try next base dir
      }
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Trail asset not found." }));
  };
  return {
    name: "hyked-trail-static-assets",
    buildStart() {
      ensurePrepared();
    },
    configureServer(server) {
      ensurePrepared();
      server.middlewares.use(makeMiddleware([publicDir]));
    },
    configurePreviewServer(server) {
      server.middlewares.use(makeMiddleware([distDir, publicDir]));
    },
  };
}

export default defineConfig(({ mode }) => {
  const root = process.cwd();
  const env = loadEnv(mode, root, "");
  const publicNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_CATALOG_TILE_URL", "NEXT_PUBLIC_CATALOG_TILE_ATTRIBUTION", "NEXT_PUBLIC_OPENTRAILMAP_URL"];
  const define = Object.fromEntries(publicNames.map(name => [`process.env.${name}`, JSON.stringify(env[name] ?? (name === "NEXT_PUBLIC_SUPABASE_URL" ? env.VITE_SUPABASE_URL : name === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ? env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY : undefined)) ?? "undefined"]));
  return {
    root: path.join(root, "src/web"), envDir: root, publicDir: path.join(root, "public"), plugins: [trailStaticAssetsPlugin(root), react()], define,
    resolve: { alias: [
      ...["link", "navigation", "image", "dynamic"].map(name => ({ find: `next/${name}`, replacement: path.join(root, `src/web/compat/${name}.${name === "navigation" ? "ts" : "tsx"}`) })),
      { find: "@", replacement: path.join(root, "src") },
    ], dedupe: ["react", "react-dom"] },
    build: { outDir: path.join(root, "dist"), emptyOutDir: true },
    server: { host: "0.0.0.0", port: 8080, allowedHosts: true, fs: { allow: [root] } },
  };
});