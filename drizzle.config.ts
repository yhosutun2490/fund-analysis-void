import { defineConfig } from "drizzle-kit";

// schema.ts 為唯一真相來源;`drizzle-kit generate` 產生 migration 到 ./db/migrations
export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
