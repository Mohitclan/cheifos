import type { NextConfig } from "next";

/**
 * Every page in ChiefOS reads the database on every request, so there is
 * nothing to prerender and nothing to cache. cacheComponents is deliberately
 * off: with synchronous node:sqlite reads it only produces prerender
 * validation noise for data that is dynamic by definition.
 */
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
