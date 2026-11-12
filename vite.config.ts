import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function trailStaticAssetsPlugin(root: string): Plugin {
  const publicDir = path.join(root, "public");
  const distDir = path.join(root, "dist");
  const currentJson = path.join(publicDir, "trail-data", "current.json");
  let isBuild = false;
  let mapEnsured = false;
  let preparing = false;

  const nodeBin = () => {
    for (const candidate of ["/usr/bin/node", "/usr/local/bin/node"]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return process.execPath;
  };

  const ensureMapSync = () => {
    if (mapEnsured) return;
    mapEnsured = true;
    if (!fs.existsSync(path.join(publicDir, "maplibre"))) {
      execFileSync(nodeBin(), [path.join(root, "scripts/prepare-map-assets.mjs")], { cwd: root, stdio: "inherit" });
    }
  };

  const ensureTrailsSync = () => {
    if (fs.existsSync(currentJson)) return;
    const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
    if (fs.existsSync(tsxCli)) {
      execFileSync(nodeBin(), ["--max-old-space-size=1280", tsxCli, path.join(root, "scripts/prepare-trail-assets.ts"), "--if-ready"], { cwd: root, stdio: "inherit" });
    }
  };

  const ensureTrailsAsync = () => {
    if (preparing || fs.existsSync(currentJson)) return;
    const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
    if (!fs.existsSync(tsxCli)) return;
    preparing = true;
    const child = spawn(nodeBin(), ["--max-old-space-size=1280", tsxCli, path.join(root, "scripts/prepare-trail-assets.ts"), "--if-ready"], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", () => { preparing = false; });
    child.on("error", () => { preparing = false; });
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
    if (rawUrl.startsWith("/trail-data/") && (preparing || !fs.existsSync(currentJson))) {
      ensureTrailsAsync();
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "2");
      res.end(JSON.stringify({ preparing: true, error: "Trail data is still being prepared." }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Trail asset not found." }));
  };
  return {
    name: "hyked-trail-static-assets",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    buildStart() {
      ensureMapSync();
      if (isBuild) ensureTrailsSync();
    },
    configureServer(server) {
      ensureMapSync();
      ensureTrailsAsync();
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