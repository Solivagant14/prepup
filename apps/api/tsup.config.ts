import { defineConfig } from "tsup";

// Bundles the API, the workspace packages and all dependencies into one file,
// so it runs with plain Node and no node_modules.
export default defineConfig({
  entry: { server: "src/server.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
