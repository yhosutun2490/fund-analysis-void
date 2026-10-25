# fund-risks-analysis

自用/內部基金風險分析工具。Cloudflare Worker 每日 cron 從鉅亨買基金 `Search/Detail`
抓取全站基金的風險指標，存進 D1 累積月歷史，透過 Void 檔案路由提供查詢與同類相對分析。

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
   前端 / 你 ───▶ GET /api/*      ◀───────────────────────────────────┘
```

- `src/anue/search.ts`：抓取 + 正規化（`pageSize` 2000、3 頁抓完 4540 檔；`-99999999.9999` → null）
- `db/schema.ts`：**D1 schema 唯一真相來源（Drizzle）**；型別與 migration 都從它衍生
- `src/db/client.ts`：`makeDb(env.DB)` 建立帶 schema 的 drizzle 實例
- `src/repositories/*`：以 Drizzle 查詢（`funds` 覆蓋更新、`fund_risk` 以 `(fund_id, as_of)` 累積月快照）
- `src/domain/screen.ts`：快照初篩純計算（同組百分位、年度勝率、入選規則；描述性，非建議）
- `src/anue/price.ts`：鉅亨含息序列抓取（切塊、併發、串接）；`src/domain/recovery.ts`：回撤／近期報酬純計算
- `src/services/recovery.ts`：序列快取新鮮度 → 抓取／存檔 → 計算；`src/repositories/series.ts`：`fund_series` 讀寫
- `routes/`：Void 檔案路由，一個 URL 一個檔（每個 HTTP 方法一個具名 export）；`middleware/01.cors.ts`：`/api/*` 的 CORS
- `crons/daily-ingest.ts`：每日 cron 排程（與 `/admin/ingest` 共用 `runIngest`;失敗或帶 warning 時通知 Discord）
- `db/migrations/`：`drizzle-kit generate` 產生的 migration（由 schema.ts 衍生,勿手改）

## 設定與啟動

```bash
npm install

# 1. 建立 D1，把回傳的 database_id 填進 wrangler.jsonc
npx wrangler d1 create fund_risks

# 2. 套用 migration（schema 改動後先 npm run db:generate 產生新 migration）
npm run db:migrate         # 本地
npm run db:migrate:remote  # 線上

# 3. 本地開發
npm run dev
curl -X POST http://localhost:8787/admin/ingest   # 手動抓一次

# 4. 部署（cron 會自動每日執行）
npm run deploy
```

### Secrets / 環境變數

- `DISCORD_WEBHOOK_URL`（secret,選用）：cron ingest **失敗**（🔴）或**成功但帶 warning**（🟡,如鉅亨新增欄位、投資區域警告）時發 Discord 通知;乾淨成功不送。未設定即停用。
  線上以 `npx wrangler secret put DISCORD_WEBHOOK_URL --name fund-risks-analysis` 設定（Worker secret,由 env binding 讀取）;不要寫進 `void.config.ts` 的 `vars`。本機 dev 預設不設,即不送通知。

### 驗證

- **請求**：各路由檔以 `defineHandler.withValidator()` 套 `src/schemas/*` 的 query/param schema，不合法 → `400 { error: "Validation failed", issues: [{ slot, issues: [{ message, path }] }] }`（`message` 為 zh-TW 用語）。
- **回應**：各路由成功回應由 `responds()`（`src/lib/validation.ts`）對 `src/schemas/*` 的 schema 驗證（DB 列由 Drizzle 衍生）。`vite dev` / 測試中不符即 500（大聲失敗）;正式建置（`import.meta.env.PROD`）只記 log、照常回傳。
- **上游鉅亨**：回應以 zod 驗證。破壞性變動 → 抓取失敗、`ingest_runs` 記 `status:error`;多出未知欄位 → 記 warning（`src/anue/knownKeys.ts` 為已知欄位快照,確認無害後補進清單即可）。

## 端點

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/admin/ingest` | 手動觸發抓取（與 cron 同流程） |
| GET | `/api/funds` | 清單；query：`group` `category` `currency` `rr` `domicile` `minSharpe3y` `maxStd1y` `sort`(sharpe_3y/std_1y/ret_3y/aum_twd) `order` `limit` `offset` |
| GET | `/api/funds/:id` | 單檔基本資料（含投資區域 `investment_area`）+ 最新快照（含近 3 個月 `ret_3m`、6 個月 `ret_6m` 報酬） |
| GET | `/api/funds/:id/history` | 風險指標月歷史（cron 累積） |
| GET | `/api/funds/:id/recovery` | 回復分析；query：`from` `to`(YYYY-MM-DD 分析窗口)`minDepth`(10,回撤事件門檻 %)`refresh`(true 強制整條重抓)。鉅亨含息序列(`PerformanceHIS`)的最大回撤 `mdd`、歷次回撤清單 `episodes`(深度 ≥ `minDepth`,依深度排序)、預設事件 `events`(2020 疫情/2022 升息/2025 關稅,未覆蓋 → `not_covered`)、單筆進場風險 `lump_sum`(仍虧損進場日比例、最長回本天數含未回本開放區間、持有 1Y/3Y 的虧損機率/最差/中位)與近期含息報酬 `recent`(3M/6M/1Y)。序列快取於 `fund_series`;新鮮用快取、過期只補抓 `[series_end,今天]` 增量串接(接不上則整條重抓)、`refresh=true` 強制整條重抓。比例/報酬皆為**小數**。`from>to`/日期格式錯/`minDepth` 非 (0,100) → 400;未知基金 404、上游失敗無快取 502、有效點<60 回 `series_too_short` |
| GET | `/api/screen` | 快照初篩；範圍篩選 `category` `area` `group` `domicile` `currency`(皆可多值逗號分隔、同參數 OR、跨參數 AND)`maxRr`(1–5)——`category`/`area`/`group` 至少擇一;規則參數 `minSharpePct`(50) `minDropPct`(40) `minWins`(3) `weakPct`(40) `weakWindows`(6m,1y) `limit`(100)。**篩選只決定回傳哪些基金,百分位永遠以完整 (category,currency) 組計算**。依組算 3Y 夏普／最差年度跌幅組內百分位與年度勝率,套三道門檻篩出 `passed`,列 `rejected_count`、`insufficient`;每組含 `peer_count`(完整組)、`matched_count`(篩選後);每檔附 `ladder`(3M/6M/1Y 報酬組內百分位)、`weak_flag`(三態)與 `recovery`(已用 `/recovery` 分析過的基金帶出全期間摘要:`mdd`/`mdd_recovered`/`mdd_underwater_days`/`still_underwater_ratio`/`loss_prob_1y`/`series_end`,未分析→null);頂層回 `filters` |
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
