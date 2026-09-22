import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { proxyClientMaxBodySize: "55mb", proxyTimeout: 150000 },
  compress: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8100/api/:path*",
      },
    ];
  },
};
export default config;
