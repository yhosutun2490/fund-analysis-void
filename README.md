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
- `src/analysis.ts`：同類基金組內 z-score 加權合成（描述性，非建議）
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
| GET | `/api/funds/:id` | 單檔基本資料 + 最新快照 |
| GET | `/api/funds/:id/history` | 風險指標月歷史（cron 累積） |
| GET | `/api/analyze` | 同類相對分析；query：`category`(必填) `currency` `wSharpe` `wStd` `wMaxdrop` `limit` |
| GET | `/api/meta/categories` | 基金組別清單與檔數 |
| GET | `/api/meta/runs` | 近 20 次抓取紀錄 |

## 口徑提醒（務必在 UI 揭露）

- 夏普 `sharpe_*` 為**月報酬口徑、未年化**，勿與其他網站的年化夏普比較。
- `std_1y` 僅 1 年；`maxdrop_y1..5` 為各年度最大跌幅（粗略 MDD，非真正回撤）。
- 風險指標 `as_of`：境內用指標截止日（月更），境外回退月底基準日——**同一表內 as_of 可能跨月份**，嚴格同期比較時需自行對齊。
- **Beta 本資料源沒有**，需日後自公開 NAV + 指定基準回歸自算（見 spec 第 5 節）。
- `analyze` 的 `score` 只在同 `category` 組內有意義，是相對穩健度，不是買賣建議。
