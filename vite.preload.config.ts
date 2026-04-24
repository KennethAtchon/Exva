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
    lib: {
      entry: path.resolve(__dirname, "electron/preload/index.ts"),
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rollupOptions: {
      external: ["better-sqlite3", "keytar"],
    },
  },
});
