import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./electron/main/db/schema.ts",
  out: "./electron/main/db/drizzle",
  dialect: "sqlite",
});
