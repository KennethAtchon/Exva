import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@electron": path.resolve(__dirname, "./electron"),
      "@main": path.resolve(__dirname, "./electron/main"),
      "@shared": path.resolve(__dirname, "./electron/shared"),
    },
  },
  test: {
    environment: "node",
    include: [
      "electron/main/**/*.test.ts",
      "electron/shared/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "electron/main/services/**/*.ts",
        "electron/main/db/repositories/**/*.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
