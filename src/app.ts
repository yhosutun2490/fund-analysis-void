import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { admin } from "./routes/admin";
import { analyze } from "./routes/analyze";
import { funds } from "./routes/funds";
import { meta } from "./routes/meta";
import { root } from "./routes/root";

const app = new Hono<{ Bindings: Env }>()
  .use("/api/*", cors())
  .route("/", root)
  .route("/admin", admin)
  .route("/api/funds", funds)
  .route("/api/analyze", analyze)
  .route("/api/meta", meta);

export type AppType = typeof app;
export { app };
