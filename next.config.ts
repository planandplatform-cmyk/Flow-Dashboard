import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Platform exports can be a few MB. Parsers cap files at 4 MB; leave room
    // for multipart overhead. (Vercel's own request limit is 4.5 MB.)
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  partialPrefetching: true,
  // The PDF export reads its fonts and logos from disk; make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/c/\\[slug\\]/pdf": ["./src/lib/pdf/assets/**/*"],
  },
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
