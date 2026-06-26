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
    lib: {
      entry: path.resolve(__dirname, "electron/main/index.ts"),
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: ["better-sqlite3", "dotenv", "keytar"],
    },
  },
});
