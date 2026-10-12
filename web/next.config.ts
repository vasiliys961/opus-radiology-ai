import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/privacy-ocr/assets/v1/*": ["./node_modules/tesseract.js/dist/*.js","./node_modules/tesseract.js-core/*.wasm*",
      "./node_modules/@tesseract.js-data/{eng,rus}/4.0.0_best_int/*.gz"],
  },
  // Cornerstone's Emscripten codecs include require("fs") in a Node-only
  // branch. Turbopack resolves it while bundling client chunks. Alias only
  // in the browser, leaving the real Node.js fs available on the server.
  // https://nextjs.org/docs/app/guides/upgrading/version-16
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/browser-fs.ts" },
    },
  },
};

export default nextConfig;
