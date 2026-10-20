import type { NextConfig } from "next";
import path from "path";

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
  outputFileTracingIncludes: { "/*": ["./data/trail-catalog/**/*", "./data/towns/**/*"] },
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
