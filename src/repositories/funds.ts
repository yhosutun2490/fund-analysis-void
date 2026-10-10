import type { RiskRow } from "../analysis";

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

export interface FundListQuery {
  group?: string;
  category?: string;
  currency?: string;
  rr?: string;
  domicile?: string;
  minSharpe3y?: number;
  maxStd1y?: number;
  sort?: string; // 不在 SORTABLE 內則回退 sharpe_3y
  order: "ASC" | "DESC";
  limit: number;
  offset: number;
}

/** 基金清單 + 篩選 + 排序（以最新快照） */
export async function listFunds(db: D1Database, q: FundListQuery) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const add = (cond: string, val: unknown) => { where.push(cond); binds.push(val); };

  if (q.group) add("f.fund_group = ?", q.group);
  if (q.category) add("f.category = ?", q.category);
  if (q.currency) add("f.currency = ?", q.currency);
  if (q.rr) add("f.rr = ?", q.rr);
  if (q.domicile) add("f.domicile = ?", q.domicile);
  if (q.minSharpe3y !== undefined) add("r.sharpe_3y >= ?", q.minSharpe3y);
  if (q.maxStd1y !== undefined) add("r.std_1y <= ?", q.maxStd1y);

  const sortCol = SORTABLE[q.sort ?? "sharpe_3y"] ?? "r.sharpe_3y";

  // NULL 排在最後
  const sql =
    `${LATEST_RISK_CTE}` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY (${sortCol} IS NULL), ${sortCol} ${q.order} LIMIT ? OFFSET ?`;
  binds.push(q.limit, q.offset);

  const { results } = await db.prepare(sql).bind(...binds).all();
  return results;
}

/** 同類分析用：某 category（可選 currency）的最新快照 */
export async function listLatestByCategory(db: D1Database, category: string, currency?: string): Promise<RiskRow[]> {
  const binds: unknown[] = [category];
  let filter = "f.category = ?";
  if (currency) { filter += " AND f.currency = ?"; binds.push(currency); }

  const sql = `${LATEST_RISK_CTE} WHERE ${filter}`;
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results as unknown as RiskRow[];
}

export function getFund(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM funds WHERE fund_id = ?").bind(id).first();
}

export function getLatestRisk(db: D1Database, id: string) {
  return db
    .prepare("SELECT * FROM fund_risk WHERE fund_id = ? ORDER BY as_of DESC LIMIT 1")
    .bind(id)
    .first();
}

/** 單檔風險歷史（cron 累積出來的月序列） */
export async function getRiskHistory(db: D1Database, id: string) {
  const { results } = await db
    .prepare("SELECT * FROM fund_risk WHERE fund_id = ? ORDER BY as_of ASC")
    .bind(id)
    .all();
  return results;
}

export async function listCategories(db: D1Database) {
  const { results } = await db
    .prepare("SELECT category, fund_group, COUNT(*) AS n FROM funds WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC")
    .all();
  return results;
}
