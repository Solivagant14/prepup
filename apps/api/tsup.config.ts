import { defineConfig } from "tsup";

// Bundles the API, the workspace packages and all dependencies into two files,
// so the production image needs no node_modules.
export default defineConfig({
  entry: { server: "src/server.ts", migrate: "src/migrate.ts" },
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
