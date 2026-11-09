import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs separately on :8080; these paths are proxied to it.
// In production Vercel routes the same paths to the API function.
const api = "http://localhost:8080";
const proxied = ["/api", "/mcp", "/app-config", "/oauth", "/.well-known", "/health"];

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: Object.fromEntries(proxied.map((p) => [p, api])) },
  build: { outDir: "dist", sourcemap: false },
});
