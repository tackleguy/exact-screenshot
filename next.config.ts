import type { NextConfig } from "next";
import { readFileSync } from "fs";
import path from "path";

// The server reads only the current snapshot's index, manifest, lines, aliases and audit (src/lib/trail-catalog/
// server.ts). Older snapshots, the worldwide country files and the hike-feature layer are served as static files
// by the web app, and would push the server functions past the hosting size limit.
const snapshot = (() => {
  try { return (JSON.parse(readFileSync(path.join(__dirname, "data/trail-catalog/current.json"), "utf8")) as { directory: string }).directory; } catch { return "snapshot-*"; }
})();

const nextConfig: NextConfig = {
  devIndicators: false,
  // Map styles, sprites and the MapLibre worker are static files other frontends (the Hyked Lovable app) load.
  async headers() {
    const cors = [{ key: "Access-Control-Allow-Origin", value: "*" }];
    return [
      { source: "/opentrailmap/:path*", headers: cors },
      { source: "/maplibre/:path*", headers: cors },
    ];
  },
  outputFileTracingIncludes: { "/*": ["./data/trail-catalog/*.json", `./data/trail-catalog/${snapshot}/*.json*`, "./data/towns/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/trail-catalog/*/world/**", "./data/trail-catalog/*/features/**", "./data/sources/**", "./.cache/**"] },
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
      },
      {
        protocol: "https",
        hostname: "thumb.wikimedia.org",
      },
    ],
  },
};

export default nextConfig;
