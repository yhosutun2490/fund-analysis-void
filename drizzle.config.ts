import { defineConfig } from "drizzle-kit";

// schema.ts 為唯一真相來源;`drizzle-kit generate` 產生 migration 到 ./drizzle
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
