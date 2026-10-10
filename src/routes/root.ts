import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";

export const root = new Hono<{ Bindings: Env }>();

root.get("/", (c) =>
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
