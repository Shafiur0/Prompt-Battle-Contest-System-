import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).hostname] : [],
  // Use fresh origin connections for the local Cloudflare deployment.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Connection", value: "close" }] }];
  },
  async rewrites() {
    const identity = process.env.KEYCLOAK_INTERNAL_URL;
    return [
      { source: "/api/:path*", destination: `${process.env.API_INTERNAL_URL || "http://localhost:4000"}/api/:path*` },
      ...(identity ? [
        { source: "/realms/prompt-battle/:path*", destination: `${identity}/realms/prompt-battle/:path*` },
        { source: "/resources/:path*", destination: `${identity}/resources/:path*` },
      ] : []),
    ];
  },
  poweredByHeader: false,
};
export default nextConfig;
