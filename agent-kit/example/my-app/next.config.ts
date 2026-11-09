import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["langgraph-kit"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: path.join(__dirname, "../.."),
    resolveAlias: {
      react: "./node_modules/react",
      "react-dom": "./node_modules/react-dom",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
