import { Hono } from "hono";
import { cors } from "hono/cors";
import { DISCLAIMER } from "./disclaimer";
import type { Env } from "./env";
import { admin } from "./routes/admin";
import { analyze } from "./routes/analyze";
import { funds } from "./routes/funds";
import { meta } from "./routes/meta";
import { runIngest } from "./services/ingest";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

app.get("/", (c) =>
  c.json({
    name: "fund-risks-analysis",
    kind: "private/internal tool",
    endpoints: [
      "POST /admin/ingest",
      "GET  /api/funds?group=&category=&currency=&rr=&domicile=&minSharpe3y=&maxStd1y=&sort=sharpe_3y&order=desc&limit=50&offset=0",
      "GET  /api/funds/:id",
      "GET  /api/funds/:id/history",
      "GET  /api/analyze?category=台灣股票&currency=TWD&limit=50",
      "GET  /api/meta/categories",
      "GET  /api/meta/runs",
    ],
    disclaimer: DISCLAIMER,
  }),
);

app.route("/admin", admin);
app.route("/api/funds", funds);
app.route("/api/analyze", analyze);
app.route("/api/meta", meta);

export default {
  fetch: app.fetch,
  // Cron Trigger
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runIngest(env).then(
      (r) => console.log("ingest ok", JSON.stringify(r)),
      (e) => console.error("ingest failed", e),
    ));
  },
};
