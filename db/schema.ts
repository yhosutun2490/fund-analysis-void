// D1 schema 的唯一真相來源（Drizzle）。改這裡 → drizzle-kit generate 產生 migration。
// 口徑/來源註解見各欄位;資料帶 lipperid（理柏授權）,僅供內部分析。
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 基金基本資料。每檔基金一列,以鉅亨代碼 `fund_id` 為主鍵。
 * 每次 ingest 覆蓋更新（不留歷史）;`investment_area` 由 InvestmentArea 篩選反查另行維護,
 * 一般 upsert 不覆寫它。索引涵蓋常用篩選維度（組別/類別/RR/區域）。
 */
export const funds = sqliteTable(
  "funds",
  {
    fundId: text("fund_id").primaryKey(), // 鉅亨代碼,如 A07212
    isin: text("isin"), // 跨來源對照 key
    lipperId: integer("lipper_id"),
    name: text("name").notNull(),
    fundGroup: text("fund_group"), // 股票型/債券型...
    category: text("category"), // lippertW2_CHI,如 台灣股票
    currency: text("currency"), // fundCcyCode
    domicile: text("domicile"), // onshore(A)/offshore(B)（由代碼推斷）
    investmentArea: text("investment_area"), // 投資區域（InvestmentArea 篩選反查建立）
    rr: text("rr"), // RR1..RR5
    esgScore: real("esg_score"),
    setupDate: text("setup_date"),
    aumTwd: real("aum_twd"), // fundtnA_TWD
    updatedAt: text("updated_at").notNull(), // 最後抓取時間 (ISO)
  },
  (t) => [
    index("idx_funds_group").on(t.fundGroup),
    index("idx_funds_category").on(t.category),
    index("idx_funds_rr").on(t.rr),
    index("idx_funds_area").on(t.investmentArea),
  ],
);

/**
 * 風險指標快照。以 `(fund_id, as_of)` 為複合主鍵,每月累積一筆 ——
 * 這是鉅亨不提供、靠每日 ingest 自行累積出來的歷史序列。
 * 口徑：`*MEJ` = 月底基準;夏普為「月報酬口徑、未年化」,勿與年化夏普混比;
 * `roi_y*` / `maxdrop_y*` 期間口徑未驗證,僅供同組相對比較。
 */
export const fundRisk = sqliteTable(
  "fund_risk",
  {
    fundId: text("fund_id").notNull(),
    asOf: text("as_of").notNull(), // dataTime,風險指標資料截至日（月更）
    std1y: real("std_1y"), // 年化標準差(%)
    sharpe1y: real("sharpe_1y"),
    sharpe3y: real("sharpe_3y"),
    sharpe5y: real("sharpe_5y"),
    sharpe10y: real("sharpe_10y"),
    ret3m: real("ret_3m"), // perF_3MMEJ 近3個月報酬(%),月底基準
    ret6m: real("ret_6m"), // perF_6MMEJ 近6個月報酬(%),月底基準
    ret1y: real("ret_1y"), // perF_1YMEJ (%)
    ret3y: real("ret_3y"), // perF_3YMEJ (%)
    ret5y: real("ret_5y"), // perF_5YMEJ (%)
    roiY1: real("roi_y1"), // year_ROI1 近1年度報酬(%)
    roiY2: real("roi_y2"),
    roiY3: real("roi_y3"),
    roiY4: real("roi_y4"),
    roiY5: real("roi_y5"),
    maxdropY1: real("maxdrop_y1"), // year_MaxQuoteChange1 近1年度最大跌幅(%)
    maxdropY2: real("maxdrop_y2"),
    maxdropY3: real("maxdrop_y3"),
    maxdropY4: real("maxdrop_y4"),
    maxdropY5: real("maxdrop_y5"),
    lipperTotal: text("lipper_total"), // llsRatings
    nav: real("nav"),
    navDate: text("nav_date"),
    ingestedAt: text("ingested_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fundId, t.asOf] }), index("idx_risk_asof").on(t.asOf)],
);

/**
 * 含息累積報酬序列快取。一檔一列,`points` 存全期間日指數 JSON,供 `/recovery` 回復分析。
 * 過期時增量補抓最後一段並串接;每次寫入同時更新全期間摘要欄
 * （`mdd` / `mdd_recovered` / `mdd_underwater_days` / `still_underwater_ratio` / `loss_prob_1y`）,
 * 供 `/api/screen` 的 `recovery` 欄位帶出。
 */
export const fundSeries = sqliteTable("fund_series", {
  fundId: text("fund_id").primaryKey(),
  basis: text("basis").notNull(), // 'total_return'（含配息）
  seriesStart: text("series_start").notNull(),
  seriesEnd: text("series_end").notNull(),
  points: text("points").notNull(), // JSON [["YYYY-MM-DD", index], …]
  fetchedAt: text("fetched_at").notNull(),
  // 預設窗口（全期間）摘要,供 /api/screen 帶出
  mdd: real("mdd"),
  mddRecovered: integer("mdd_recovered"),
  mddUnderwaterDays: integer("mdd_underwater_days"),
  stillUnderwaterRatio: real("still_underwater_ratio"),
  lossProb1y: real("loss_prob_1y"),
});

/**
 * 每次抓取（cron 或手動 /admin/ingest）的執行紀錄,稽核用。
 * 自增 id;`status` 為 ok/error;`note` 記警告或錯誤（如投資區域部分失敗）。
 */
export const ingestRuns = sqliteTable("ingest_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  dataTime: text("data_time"), // 回傳的 dataTime
  totalCount: integer("total_count"), // dataCount
  upserted: integer("upserted"),
  status: text("status"), // ok / error
  note: text("note"),
});

/**
 * 管理員動作的 email 驗證碼（觸發驗證）。每次要求驗證碼一列;`purpose` 目前只有 `ingest`,保留給其他 admin 動作。
 * 綁定發碼的 session;只存 `SHA-256(id + ":" + code)`,不存明文。
 * 「目前有效」= 同 session、同 purpose 最新一筆未作廢、未使用、未過期者。
 * `revoked_at`:被新碼取代（或錯誤次數用盡）的時刻;`used_at`:驗證成功、動作開始的時刻（觸發冷卻的依據）。
 */
export const adminChallenges = sqliteTable(
  "admin_challenges",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    purpose: text("purpose").notNull(), // ingest
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    codeHash: text("code_hash").notNull(), // hex(SHA-256(id + ":" + code))
    createdAt: text("created_at").notNull(), // ISO
    expiresAt: text("expires_at").notNull(), // ISO
    revokedAt: text("revoked_at"),
    usedAt: text("used_at"),
    attempts: integer("attempts").notNull().default(0), // 錯誤嘗試次數
  },
  (t) => [
    index("idx_challenges_session").on(t.sessionId, t.purpose),
    index("idx_challenges_used").on(t.purpose, t.usedAt),
  ],
);
