import type { NextConfig } from "next";

// The built web app (apps/web/dist) is embedded into public/ at build time, so
// Next serves the SPA's assets from /assets/* and index.html from /index.html.
// Serve it at the root too. The app has no client-side routing, so a single
// root rewrite is enough.
const nextConfig: NextConfig = {
  // The MCP tool definitions are TypeScript source in a workspace package.
  transpilePackages: ["@floaters/mcp-tools"],
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
