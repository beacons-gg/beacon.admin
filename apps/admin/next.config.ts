import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * The console is a client-side app over Beacon's client packages, with no server-side key custody
 * and no API routes: the Next server is a static shell. Servers are entered by
 * the operator at runtime, so nothing here needs environment configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The image (Dockerfile) carries only what this emits: a self-contained server under
  // .next/standalone, traced from the repository root below, plus .next/static beside it.
  output: "standalone",
  // Pin the workspace root to this repository's root (Next otherwise infers it by scanning upward
  // for lockfiles and can land on a stray one outside the repo).
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};

export default nextConfig;
