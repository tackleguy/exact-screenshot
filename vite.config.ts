import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig(({ mode }) => {
  const root = process.cwd();
  const env = loadEnv(mode, root, "");
  const publicNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_CATALOG_TILE_URL", "NEXT_PUBLIC_CATALOG_TILE_ATTRIBUTION"];
  const define = Object.fromEntries(publicNames.map(name => [`process.env.${name}`, JSON.stringify(env[name] ?? (name === "NEXT_PUBLIC_SUPABASE_URL" ? env.VITE_SUPABASE_URL : name === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ? env.VITE_SUPABASE_PUBLISHABLE_KEY : undefined)) ?? "undefined"]));
  return {
    root: path.join(root, "src/web"), envDir: root, publicDir: path.join(root, "public"), plugins: [react()], define,
    resolve: { alias: [
      ...["link", "navigation", "image", "dynamic"].map(name => ({ find: `next/${name}`, replacement: path.join(root, `src/web/compat/${name}.${name === "navigation" ? "ts" : "tsx"}`) })),
      { find: "@", replacement: path.join(root, "src") },
    ], dedupe: ["react", "react-dom"] },
    build: { outDir: path.join(root, "dist"), emptyOutDir: true },
    server: { host: "0.0.0.0", port: 8080, allowedHosts: true, fs: { allow: [root] } },
  };
});