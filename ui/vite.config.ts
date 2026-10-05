import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `bun run dev:ui` proxies /api to a running engine. Pass its token with EXVA_TOKEN.
const engine = process.env.EXVA_ENGINE_URL ?? "http://127.0.0.1:7420";
const token = process.env.EXVA_TOKEN ?? "";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwind()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: engine,
        changeOrigin: true,
        ws: true,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
    },
  },
});
