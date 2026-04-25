import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@electron": path.resolve(__dirname, "electron"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "node22",
    rollupOptions: {
      external: ["electron", "better-sqlite3", "keytar"],
    },
  },
});
