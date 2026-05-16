import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Parent repo has its own lockfile; pin Turbopack root to this Next.js app.
    root: process.cwd(),
  },
};

export default nextConfig;
