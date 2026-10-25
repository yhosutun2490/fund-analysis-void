// GET /:服務自我描述。endpoints 清單手寫,不從 route map 產生。
import { defineHandler } from "void";
import { DISCLAIMER } from "../src/schemas/shared";
import { RootResponse } from "../src/schemas/root";
import { responds } from "../src/lib/validation";

export const GET = responds(
  { 200: RootResponse },
  defineHandler((c) =>
    c.json({
      name: "fund-risks-analysis",
      kind: "private/internal tool",
      endpoints: [
        "POST /admin/ingest",
        "GET  /api/funds?group=&category=&currency=&rr=&domicile=&minSharpe3y=&maxStd1y=&sort=sharpe_3y&order=desc&limit=50&offset=0",
        "GET  /api/funds/:id",
        "GET  /api/funds/:id/history",
        "GET  /api/funds/:id/recovery?from=&to=&minDepth=10&refresh=false",
        "GET  /api/screen?category=台灣股票&area=亞洲&group=股票型&domicile=offshore&currency=TWD&maxRr=3&minSharpePct=50&minDropPct=40&minWins=3&weakPct=40&weakWindows=6m,1y&limit=100",
        "GET  /api/meta/categories",
        "GET  /api/meta/runs",
      ],
      disclaimer: DISCLAIMER,
    }),
  ),
);
