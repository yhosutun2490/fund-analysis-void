import { Hono } from "hono";
import { analyzePeerGroup } from "../analysis";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";
import { listLatestByCategory } from "../repositories/funds";

export const analyze = new Hono<{ Bindings: Env }>();

// 同類相對分析
analyze.get("/", async (c) => {
  const q = c.req.query();
  if (!q.category) return c.json({ error: "category 為必填（確保同組可比較）" }, 400);
  const rows = await listLatestByCategory(c.env.DB, q.category, q.currency);
  const scored = analyzePeerGroup(rows, {
    wSharpe: q.wSharpe ? Number(q.wSharpe) : undefined,
    wStd: q.wStd ? Number(q.wStd) : undefined,
    wMaxdrop: q.wMaxdrop ? Number(q.wMaxdrop) : undefined,
  });
  const limit = Math.min(Number(q.limit ?? "50"), 500);
  return c.json({
    category: q.category,
    currency: q.currency ?? "(all)",
    peer_count: rows.length,
    scored_count: scored.filter((s) => s.score != null).length,
    note: "score 為同組 z-score 加權合成的相對穩健度，僅在本組內可比；資料不足者 score=null。",
    disclaimer: DISCLAIMER,
    results: scored.slice(0, limit),
  });
});
