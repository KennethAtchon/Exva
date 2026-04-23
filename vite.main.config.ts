import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@electron": path.resolve(__dirname, "electron"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
