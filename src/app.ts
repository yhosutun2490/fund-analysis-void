import { Hono } from "hono";
import type { Env } from "./bindings";
import { admin } from "./routes/admin";
import { funds } from "./routes/funds";
import { meta } from "./routes/meta";
import { root } from "./routes/root";
import { screen } from "./routes/screen";

const app = new Hono<{ Bindings: Env }>()
  .route("/", root)
  .route("/admin", admin)
  .route("/api/funds", funds)
  .route("/api/screen", screen)
  .route("/api/meta", meta);

export type AppType = typeof app;
export { app };
