/**
 * Builds PrepUp for Vercel using the Build Output API: the web app as static
 * files, and the whole API (REST, MCP, consent page) as one Node function.
 * Writing .vercel/output ourselves keeps the deploy explicit and reproducible.
 * https://vercel.com/docs/build-output-api
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vercel/output");
const fn = join(out, "functions/server.func");

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

// 1. The web app.
execSync("pnpm --filter @prepup/web build", { cwd: root, stdio: "inherit" });
cpSync(join(root, "apps/web/dist"), join(out, "static"), { recursive: true });

// 2. The API, bundled with every dependency into a single file.
await build({
  entry: { index: join(root, "apps/api/src/vercel.ts") },
  outDir: fn,
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/.*/],
  outExtension: () => ({ js: ".mjs" }),
  sourcemap: false,
  silent: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
writeFileSync(join(fn, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 30,
    },
    null,
    2,
  ),
);

// 3. Routing: API paths go to the function (with the original path kept),
//    real files are served as-is, and everything else is the web app.
const apiPaths = "api/.*|mcp|health|app-config|oauth/consent|\\.well-known/.*";
writeFileSync(
  join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: `^/(${apiPaths})$`, dest: "/server?__path=/$1" },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log("Vercel output written to .vercel/output");
