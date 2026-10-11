import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";

// 以方法鏈定義,讓 GET / 的回應型別被 typeof root 捕捉,testClient 才推得出來
export const root = new Hono<{ Bindings: Env }>().get("/", (c) =>
  c.json({
    name: "fund-risks-analysis",
    kind: "private/internal tool",
    endpoints: [
      "POST /admin/ingest",
      "GET  /api/funds?group=&category=&currency=&rr=&domicile=&minSharpe3y=&maxStd1y=&sort=sharpe_3y&order=desc&limit=50&offset=0",
      "GET  /api/funds/:id",
      "GET  /api/funds/:id/history",
      "GET  /api/funds/:id/recovery",
      "GET  /api/screen?category=台灣股票&area=亞洲&group=股票型&domicile=offshore&currency=TWD&maxRr=3&minSharpePct=50&minDropPct=40&minWins=3&weakPct=40&weakWindows=6m,1y&limit=100",
      "GET  /api/meta/categories",
      "GET  /api/meta/runs",
    ],
    disclaimer: DISCLAIMER,
  }),
);
