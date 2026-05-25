import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@electron": path.resolve(__dirname, "electron"),
      "@main": path.resolve(__dirname, "electron/main"),
      "@shared": path.resolve(__dirname, "electron/shared"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "node22",
    outDir: path.resolve(__dirname, ".vite/build"),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(
        __dirname,
        "electron/main/workers/session-runtime-worker.ts",
      ),
      formats: ["cjs"],
      fileName: () => "session-runtime-worker.cjs",
    },
    rollupOptions: {
      external: ["better-sqlite3", "keytar", "electron"],
    },
  },
});
