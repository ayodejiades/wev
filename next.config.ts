import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Build output directory. Defaults to `.next`; the reference-present browser
   * run (tools/e2e-reference.sh) builds into `.next-e2e` so an already-built
   * app is never mutated underneath a test.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;