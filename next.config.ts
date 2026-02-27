import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  // pg might need to be external if using native bindings, but usually fine.
  // We can remove better-sqlite3.
};

export default nextConfig;
