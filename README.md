# fund-risks-analysis

自用/內部基金風險分析工具。Cloudflare Worker 每日 cron 從鉅亨買基金 `Search/Detail`
抓取全站基金的風險指標，存進 D1 累積月歷史，透過 Hono 提供查詢與同類相對分析。

> **定位：自用/內部工具。** 回傳資料含理柏（Lipper）授權指標（每筆有 `lipperid`）。
> 僅供內部分析，**請勿對外公開 API 或轉載這些授權欄位**——若要公開，須依
> [產品設計 spec](docs/superpowers/specs/2026-10-10-fund-drawdown-recovery-analyzer-design.md)
> 改為自公開 NAV 計算指標。API 合約與口徑見
> [逆向紀錄](docs/research/2026-10-10-anue-fund-search-api.md)。

## 架構

```
Cron (每日)  ─┐
POST /admin/ingest ─┴─▶ fetchAllFunds() ─▶ normalize(哨兵值→null) ─▶ D1 upsert
                                                                      │
   前端 / 你 ───▶ Hono GET /api/* ◀───────────────────────────────────┘
```

- `src/anue.ts`：抓取 + 正規化（`pageSize` 2000、3 頁抓完 4540 檔；`-99999999.9999` → null）
- `src/db.ts`：D1 upsert（`funds` 覆蓋更新、`fund_risk` 以 `(fund_id, as_of)` 累積月快照）
- `src/screen.ts`：快照初篩純計算（同組百分位、年度勝率、入選規則；描述性，非建議）
- `src/index.ts`：Hono 路由 + `scheduled` cron handler
- `schema.sql`：D1 schema

## 設定與啟動

```bash
npm install

# 1. 建立 D1，把回傳的 database_id 填進 wrangler.toml
npx wrangler d1 create fund_risks

# 2. 灌 schema
npm run db:init            # 本地
npm run db:init:remote     # 線上

# 既有 DB 升級（新欄位 ret_3m/ret_6m）；全新建庫不需要
npm run db:migrate         # 本地
npm run db:migrate:remote  # 線上

# 3. 本地開發
npm run dev
curl -X POST http://localhost:8787/admin/ingest   # 手動抓一次

# 4. 部署（cron 會自動每日執行）
npm run deploy
```

## 端點

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/admin/ingest` | 手動觸發抓取（與 cron 同流程） |
| GET | `/api/funds` | 清單；query：`group` `category` `currency` `rr` `domicile` `minSharpe3y` `maxStd1y` `sort`(sharpe_3y/std_1y/ret_3y/aum_twd) `order` `limit` `offset` |
| GET | `/api/funds/:id` | 單檔基本資料（含投資區域 `investment_area`）+ 最新快照（含近 3 個月 `ret_3m`、6 個月 `ret_6m` 報酬） |
| GET | `/api/funds/:id/history` | 風險指標月歷史（cron 累積） |
| GET | `/api/screen` | 快照初篩；範圍篩選 `category` `area` `group` `domicile` `currency`(皆可多值逗號分隔、同參數 OR、跨參數 AND)`maxRr`(1–5)——`category`/`area`/`group` 至少擇一;規則參數 `minSharpePct`(50) `minDropPct`(40) `minWins`(3) `weakPct`(40) `weakWindows`(6m,1y) `limit`(100)。**篩選只決定回傳哪些基金,百分位永遠以完整 (category,currency) 組計算**。依組算 3Y 夏普／最差年度跌幅組內百分位與年度勝率,套三道門檻篩出 `passed`,列 `rejected_count`、`insufficient`;每組含 `peer_count`(完整組)、`matched_count`(篩選後);每檔附 `ladder`(3M/6M/1Y 報酬組內百分位)與 `weak_flag`(三態);頂層回 `filters` |
| GET | `/api/meta/categories` | 基金組別清單與檔數 |
| GET | `/api/meta/runs` | 近 20 次抓取紀錄 |

## 口徑提醒（務必在 UI 揭露）

- 夏普 `sharpe_*` 為**月報酬口徑、未年化**，勿與其他網站的年化夏普比較。
- `std_1y` 僅 1 年；`maxdrop_y1..5` 為各年度最大跌幅（粗略 MDD，非真正回撤）。
- 風險指標 `as_of`：境內用指標截止日（月更），境外回退月底基準日——**同一表內 as_of 可能跨月份**，嚴格同期比較時需自行對齊。日期若為鉅亨的 `1900-` 哨兵值則存 null。
- `ret_3m`／`ret_6m`（`perF_3MMEJ`／`perF_6MMEJ`）為近 3／6 個月報酬，**月底基準**，與 `ret_1y..5y` 同口徑。
- **Beta 本資料源沒有**，需日後自公開 NAV + 指定基準回歸自算（見 spec 第 5 節）。
- `screen` 的百分位與勝率只在同 `(category, currency)` 組內有意義，是相對位置，不是買賣建議。
- `year_ROI*`／`year_MaxQuoteChange*` 期間口徑未驗證，僅用於同組相對比較，回應標示 `basis: "anue_year_fields_unverified"`，不顯示為「某年報酬」。
