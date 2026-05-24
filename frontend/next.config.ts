import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chinese path workaround for Turbopack
  output: "standalone",
};

export default nextConfig;
