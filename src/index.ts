import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchAllFunds, normalize } from "./anue";
import { upsertRecords, recordRun, type Env } from "./db";
import { analyzePeerGroup, type RiskRow } from "./analysis";

const DISCLAIMER =
  "資料來源：鉅亨買基金（含理柏授權指標），僅供內部分析，非投資建議。夏普為月報酬口徑、未年化，勿與年化夏普混比。指標資料截至 as_of（月更）。";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

// 以最新 as_of 的風險快照 join 基金基本資料
const LATEST_RISK_CTE = `
  WITH latest AS (
    SELECT fund_id, MAX(as_of) AS as_of FROM fund_risk GROUP BY fund_id
  )
  SELECT f.fund_id, f.name, f.fund_group, f.category, f.currency, f.domicile, f.rr,
         f.esg_score, f.aum_twd, f.setup_date,
         r.as_of, r.std_1y, r.sharpe_1y, r.sharpe_3y, r.sharpe_5y, r.sharpe_10y,
         r.ret_1y, r.ret_3y, r.ret_5y, r.maxdrop_y1, r.lipper_total, r.nav, r.nav_date
  FROM funds f
  JOIN latest l ON l.fund_id = f.fund_id
  JOIN fund_risk r ON r.fund_id = f.fund_id AND r.as_of = l.as_of
`;

const SORTABLE: Record<string, string> = {
  sharpe_3y: "r.sharpe_3y",
  sharpe_1y: "r.sharpe_1y",
  std_1y: "r.std_1y",
  ret_3y: "r.ret_3y",
  ret_1y: "r.ret_1y",
  aum_twd: "f.aum_twd",
};

async function runIngest(env: Env) {
  const started = new Date().toISOString();
  const pageSize = Number(env.ANUE_PAGE_SIZE ?? "2000");
  try {
    const { rows, dataTime, dataCount } = await fetchAllFunds(pageSize);
    const records = rows.map(normalize);
    const upserted = await upsertRecords(env.DB, records);
    const finished = new Date().toISOString();
    await recordRun(env.DB, {
      started_at: started, finished_at: finished, data_time: dataTime,
      total_count: dataCount, upserted, status: "ok",
    });
    return { status: "ok", dataTime, dataCount, fetched: rows.length, upserted };
  } catch (e) {
    const finished = new Date().toISOString();
    const note = e instanceof Error ? e.message : String(e);
    await recordRun(env.DB, {
      started_at: started, finished_at: finished, data_time: null,
      total_count: 0, upserted: 0, status: "error", note,
    });
    throw e;
  }
}

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

// 手動觸發抓取（與 cron 同一流程）
app.post("/admin/ingest", async (c) => {
  try {
    const result = await runIngest(c.env);
    return c.json(result);
  } catch (e) {
    return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// 基金清單 + 篩選 + 排序（以最新快照）
app.get("/api/funds", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  const add = (cond: string, val: unknown) => { where.push(cond); binds.push(val); };

  if (q.group) add("f.fund_group = ?", q.group);
  if (q.category) add("f.category = ?", q.category);
  if (q.currency) add("f.currency = ?", q.currency);
  if (q.rr) add("f.rr = ?", q.rr);
  if (q.domicile) add("f.domicile = ?", q.domicile);
  if (q.minSharpe3y) add("r.sharpe_3y >= ?", Number(q.minSharpe3y));
  if (q.maxStd1y) add("r.std_1y <= ?", Number(q.maxStd1y));

  const sortCol = SORTABLE[q.sort ?? "sharpe_3y"] ?? "r.sharpe_3y";
  const order = (q.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Number(q.limit ?? "50"), 500);
  const offset = Number(q.offset ?? "0");

  // NULL 排在最後
  const sql =
    `${LATEST_RISK_CTE}` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY (${sortCol} IS NULL), ${sortCol} ${order} LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ count: results.length, limit, offset, disclaimer: DISCLAIMER, funds: results });
});

// 單檔：基本資料 + 最新快照
app.get("/api/funds/:id", async (c) => {
  const id = c.req.param("id");
  const fund = await c.env.DB.prepare("SELECT * FROM funds WHERE fund_id = ?").bind(id).first();
  if (!fund) return c.json({ error: "not found" }, 404);
  const latest = await c.env.DB
    .prepare("SELECT * FROM fund_risk WHERE fund_id = ? ORDER BY as_of DESC LIMIT 1")
    .bind(id)
    .first();
  return c.json({ fund, latest_risk: latest, disclaimer: DISCLAIMER });
});

// 單檔風險歷史（cron 累積出來的月序列）
app.get("/api/funds/:id/history", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB
    .prepare("SELECT * FROM fund_risk WHERE fund_id = ? ORDER BY as_of ASC")
    .bind(id)
    .all();
  return c.json({ fund_id: id, count: results.length, history: results, disclaimer: DISCLAIMER });
});

// 同類相對分析
app.get("/api/analyze", async (c) => {
  const q = c.req.query();
  if (!q.category) return c.json({ error: "category 為必填（確保同組可比較）" }, 400);
  const binds: unknown[] = [q.category];
  let filter = "f.category = ?";
  if (q.currency) { filter += " AND f.currency = ?"; binds.push(q.currency); }

  const sql = `${LATEST_RISK_CTE} WHERE ${filter}`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  const rows = results as unknown as RiskRow[];
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

app.get("/api/meta/categories", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT category, fund_group, COUNT(*) AS n FROM funds WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC")
    .all();
  return c.json({ categories: results });
});

app.get("/api/meta/runs", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 20")
    .all();
  return c.json({ runs: results });
});

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
