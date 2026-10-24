import { Hono } from "hono";
import type { Env } from "./bindings";
import { funds } from "./routes/funds";
import { screen } from "./routes/screen";

// 過渡用:只剩尚未遷移成原生路由檔的端點(GET /、/api/meta/*、POST /admin/ingest 已在 routes/)。
const app = new Hono<{ Bindings: Env }>()
  .route("/api/funds", funds)
  .route("/api/screen", screen);

export type AppType = typeof app;
export { app };
