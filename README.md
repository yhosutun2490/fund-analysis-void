# fund-risks-analysis

自用/內部基金風險分析工具。Cloudflare Worker 每日 cron 從鉅亨買基金 `Search/Detail`
抓取全站基金的風險指標，存進 D1 累積月歷史，透過 Void 檔案路由提供查詢與同類相對分析。

> **定位：自用/內部工具。** 回傳資料含理柏（Lipper）授權指標（每筆有 `lipperid`）。
> 僅供內部分析，**請勿對外公開 API 或轉載這些授權欄位**——若要公開，須依
> [產品設計 spec](docs/superpowers/specs/2026-10-10-fund-drawdown-recovery-analyzer-design.md)
> 改為自公開 NAV 計算指標。API 合約與口徑見
> [逆向紀錄](docs/research/2026-10-10-anue-fund-search-api.md)。

## 架構

### 資料流

```
                    ┌──────────── 寫入（每日）────────────┐
Cron 每日 ──────────┤                                      │
POST /admin/ingest ─┴─▶ services/ingest ─▶ anue/search ─▶ 正規化 ─▶ D1（funds、fund_risk、ingest_runs）
                                         （鉅亨 Search/Detail）              │
                                                                             ▼
GET /api/funds*、/api/screen、/api/meta/* ──▶ repositories ──▶ domain（純計算）──▶ JSON
GET /api/funds/:id/recovery ──▶ services/recovery ──▶ fund_series 快取 / anue/price（鉅亨含息序列）
```

### 一個請求怎麼走

```
請求
 └─ Void auth middleware                  由 session cookie 帶出 user/session(設定在 auth.ts)
     └─ middleware/01.cors.ts             /api/* 加 CORS(含 preflight;/api/auth/* 除外)
         └─ middleware/02.admin-guard.ts  /admin/* 須登入且 email 在 ADMIN_EMAILS → 否則 401/403
             ├─ /api/auth/*               Void auth(Better Auth)端點:登入、登出、session
             └─ routes/**/*.ts            一個 URL 一個檔,一個 HTTP 方法一個具名 export
                 ├─ withValidator(...)    query/params/body 驗證 → 不合法回 400
                 ├─ handler               呼叫 repositories / services / domain
                 └─ responds(...)         依狀態碼驗證回應 schema
                        ▲
                        └── 兩者的 schema 都取自 src/schemas/endpoints.ts(端點契約登錄表)
                             └─ src/lib/openapi.ts 從同一份登錄表產生 GET /openapi.json
```

`/admin/*` 除了登入,動作本身還要 email 驗證碼:先 `POST /admin/ingest/challenge` 把 6 位數碼寄到管理員自己的信箱,再帶碼 `POST /admin/ingest`。發碼、比對、重寄間隔、錯誤上限、觸發冷卻都在 `services/challenge`,資料在 `admin_challenges`。

文件和驗證用的是同一個 zod schema 物件,改了 schema,`/openapi.json` 會跟著變。

### 目錄

```
auth.ts            Void auth(Better Auth)設定:email/密碼登入,只有 ADMIN_EMAILS 內的 email 能建立帳號
routes/            Void 檔案路由(GET / 是 Swagger UI、GET /openapi.json 是 OpenAPI 文件)
middleware/        全域 middleware(01.cors.ts、02.admin-guard.ts)
crons/             排程(daily-ingest.ts:與 /admin/ingest 共用 runIngest,不經驗證碼、不受觸發冷卻;失敗或帶 warning 時通知 Discord)
db/
├── schema.ts      D1 schema 唯一真相來源(Drizzle);型別與 migration 都從它衍生
└── migrations/    npm run db:generate(void db generate)產生,含 auth 資料表;勿手改
src/
├── schemas/       請求/回應契約(zod);endpoints.ts 是端點契約登錄表
├── lib/           validation.ts(responds)、openapi.ts(文件產生器)、notify.ts(Discord)、admin.ts(isAdmin、/admin 路由共用)、email.ts(寄件者)
├── services/      流程編排:ingest(抓取→寫入)、recovery(序列快取新鮮度→抓取/存檔)、challenge(觸發驗證碼的發碼與比對)
├── repositories/  Drizzle 查詢:funds 覆蓋更新、fund_risk 以 (fund_id, as_of) 累積月快照、fund_series 讀寫、challenges(admin_challenges)
├── domain/        純計算:screen(同組百分位、年度勝率、入選規則)、recovery(回撤、近期報酬)
├── anue/          鉅亨上游:search(pageSize 2000、哨兵值 -99999999.9999 → null)、price(含息序列,切塊併發串接)、schema(上游回應驗證)
└── db/            makeDb(env.DB)、selections(select 子句與由它衍生的列 schema rowOf)
```

### 驗證

- **請求**：路由從登錄表取 query/params/body schema,以 `defineHandler.withValidator()` 驗證。不合法 → `400 { error: "Validation failed", issues: [{ slot, issues: [{ message, path }] }] }`(`message` 為 zh-TW 用語)。
- **回應**：`responds()`(`src/lib/validation.ts`)依狀態碼對登錄表的回應 schema 驗證(DB 列由 Drizzle 衍生)。`vite dev` / 測試中不符即 500(大聲失敗);正式建置(`import.meta.env.PROD`)只記 log、照常回傳。
- **上游鉅亨**：回應以 zod 驗證。破壞性變動 → 抓取失敗、`ingest_runs` 記 `status:error`;多出未知欄位 → 記 warning(`src/anue/knownKeys.ts` 為已知欄位快照,確認無害後補進清單即可)。

## 設定與啟動

```bash
npm install

# 1. 建立 D1,把回傳的 database_id 填進 void.config.ts
npx wrangler d1 create fund_risks

# 2. 套用 migration(schema 改動後先 npm run db:generate 產生新 migration)
npm run db:migrate         # 本地
npm run db:migrate:remote  # 線上

# 3. 本地開發
npm run dev                # http://localhost:5173/ 即 Swagger UI
npm run ingest:local       # 手動抓一次(登入 → 要求驗證碼 → 從本機 inbox 取碼 → 觸發;帳密環境變數見 scripts/ingest-local.mjs)

# 4. 部署(cron 會自動每日執行)
npm run deploy
```

### Secrets / 環境變數

- `DISCORD_WEBHOOK_URL`(secret,選用)：cron ingest **失敗**(🔴)或**成功但帶 warning**(🟡,如鉅亨新增欄位、投資區域警告)時發 Discord 通知;乾淨成功不送。未設定即停用。
  線上以 `npx wrangler secret put DISCORD_WEBHOOK_URL --name fund-risks-analysis` 設定(Worker secret,由 env binding 讀取);不要寫進 `void.config.ts` 的 `vars`。本機 dev 預設不設,即不送通知。
- `ADMIN_EMAILS`(secret)：管理員 email 允許清單(逗號分隔),決定誰能註冊與呼叫 `/admin/*`;未設定即沒有任何管理員。
- `CHALLENGE_TTL_SECONDS`(選用)：觸發驗證碼的有效秒數,預設 600。
- `CHALLENGE_RESEND_SECONDS`(選用)：同一管理員重新要求驗證碼的最短間隔秒數(以使用者計,不分 session),預設 60。
- `CHALLENGE_MAX_ATTEMPTS`(選用)：一組驗證碼最多可錯幾次,錯滿即作廢,預設 5。
- `CHALLENGE_COOLDOWN_SECONDS`(選用)：觸發冷卻秒數(手動觸發開始後多久內全域不能再要求驗證碼或觸發),預設 600。

## API

### 看文件、試打

- **Swagger UI**：瀏覽器打開服務根路徑 `/`(本地 `npm run dev` 後是 http://localhost:5173/)。每個端點的參數型別、範圍、預設值、範例、回應形狀和錯誤狀態碼都在這裡,可以用「Try it out」直接送出請求。
- **OpenAPI 3.1**：`GET /openapi.json`,可匯入 Postman 或用來產生 client。

參數細節以 Swagger UI 為準,下面只寫文件裡看不出來的行為。

### 端點一覽

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| POST | `/admin/ingest/challenge` | 要求手動觸發的 email 驗證碼(寄到登入管理員自己的信箱) |
| POST | `/admin/ingest` | 帶驗證碼手動觸發抓取(與 cron 同流程) |
| GET | `/api/funds` | 基金清單 + 篩選 + 排序(以最新快照) |
| GET | `/api/funds/:id` | 單檔基本資料 + 最新快照 |
| GET | `/api/funds/:id/history` | 單檔風險指標月歷史(cron 累積) |
| GET | `/api/funds/:id/recovery` | 單檔回復分析:最大回撤、回撤事件、單筆進場風險、近期報酬 |
| GET | `/api/screen` | 快照初篩:同組相對排名,依門檻篩出候選基金 |
| GET | `/api/meta/categories` | 各基金類別與檔數 |
| GET | `/api/meta/runs` | 近 20 次抓取紀錄 |

`/admin/*` 須以管理員帳號登入(session cookie),動作還要帶 email 驗證碼;`/api/*` 不需登入。

### 共通慣例

- 每個成功回應都帶固定的 `disclaimer` 字串。
- 錯誤形狀:
  - 400:上面「驗證」一節的形狀;POST body 不是 JSON → `400 { error: "Invalid JSON body" }`。
  - 401 / 403(`/admin/*`):未登入 `{ error: "unauthorized" }`、不在 `ADMIN_EMAILS` `{ error: "forbidden" }`。
  - 422(`/admin/ingest`):碼不符 `{ error: "code_mismatch", attemptsLeft }`(錯滿那次 `attemptsLeft: 0`,碼同時作廢);沒有有效的驗證碼(過期、已用、作廢、錯滿、重新要求後的舊碼、別的 session 發的)`{ error: "challenge_invalid" }`。
  - 429(`/admin/*`):`{ error: "resend_too_soon" | "cooldown", retryAfter }`,同時帶 `Retry-After` 標頭(秒,與 `retryAfter` 同值)。
  - 404、502:handler 自己回的錯誤為 `{ error: string }`;`/admin/ingest/challenge` 寄信失敗為 `502 { error: "email_send_failed" }`。
  - `/admin/ingest` 抓取失敗為 `500 { status: "error", message }`。
- `/api/*` 開放 CORS(`/api/auth/*` 除外,其他網域的頁面讀不到 auth 回應);`/admin/*` 不開。

### `/api/funds/:id/recovery` 的行為

- 序列來源:鉅亨含息序列(`PerformanceHIS`),快取於 `fund_series`。新鮮就用快取;過期只補抓 `[series_end, 今天]` 增量串接,接不上則整條重抓;`refresh=true` 強制整條重抓。
- 回傳:最大回撤 `mdd`、歷次回撤 `episodes`(深度 ≥ `minDepth`,最深在前)、預設事件 `events`(2020 疫情 / 2022 升息 / 2025 關稅,窗口未覆蓋 → `not_covered`)、單筆進場風險 `lump_sum`(仍虧損進場日比例、最長回本天數含未回本開放區間、持有 1Y/3Y 的虧損機率/最差/中位)、近期含息報酬 `recent`(3M/6M/1Y)。
- 比例與報酬皆為**小數**。
- 窗口內有效點少於 60 → 指標回 null 並標 `reason: "series_too_short"`;未知基金 404;上游失敗且無快取 502。

### `/api/screen` 的行為

- **範圍篩選**(`category` `area` `group` `domicile` `currency`,逗號分隔可多選;同參數 OR、跨參數 AND;`maxRr`)只決定**回傳哪些基金**;`category` / `area` / `group` 至少擇一。
- **百分位永遠以完整 (category, currency) 組計算**,不受其他篩選影響。每組回 `peer_count`(完整組)與 `matched_count`(篩選後)。
- 依組算 3Y 夏普與最差年度跌幅的組內百分位、年度勝率,三道門檻(`minSharpePct` `minDropPct` `minWins`)都過的列進 `passed`,其餘計入 `rejected_count`;資料不足的列進 `insufficient` 並附原因。
- 每檔附 `ladder`(3M/6M/1Y 報酬組內百分位)、`weak_flag`(三態:長期好但近期轉弱才為 true,任一窗口無資料為 null;只標記不剔除),以及 `recovery`(用 `/recovery` 分析過的基金帶出全期間摘要,未分析為 null)。

### 新增或修改端點

1. 在 `src/schemas/<資源>.ts` 寫請求/回應 schema;參數說明與範例用 `.meta()` 加上。有 transform 的欄位,`.meta()` 要掛在 transform **前面**,否則 `examples` / `default` 會在文件中遺失。
2. 在 `src/schemas/endpoints.ts` 登錄一筆(摘要、標籤、params/query、各狀態碼的回應 schema)。
3. 在 `routes/` 加路由檔,從登錄表取 schema 傳給 `withValidator()` 與 `responds()`。
4. `test/openapi.test.ts` 會檢查文件列的端點與 `routes/` 的路由檔一一對應,漏登或多登都會失敗。

## 口徑提醒（務必在 UI 揭露）

- 夏普 `sharpe_*` 為**月報酬口徑、未年化**，勿與其他網站的年化夏普比較。
- `std_1y` 僅 1 年；`maxdrop_y1..5` 為各年度最大跌幅（粗略 MDD，非真正回撤）。
- 風險指標 `as_of`：境內用指標截止日（月更），境外回退月底基準日——**同一表內 as_of 可能跨月份**，嚴格同期比較時需自行對齊。日期若為鉅亨的 `1900-` 哨兵值則存 null。
- `ret_3m`／`ret_6m`（`perF_3MMEJ`／`perF_6MMEJ`）為近 3／6 個月報酬，**月底基準**，與 `ret_1y..5y` 同口徑。
- **Beta 本資料源沒有**，需日後自公開 NAV + 指定基準回歸自算（見 spec 第 5 節）。
- `screen` 的百分位與勝率只在同 `(category, currency)` 組內有意義，是相對位置，不是買賣建議。
- `year_ROI*`／`year_MaxQuoteChange*` 期間口徑未驗證，僅用於同組相對比較，回應標示 `basis: "anue_year_fields_unverified"`，不顯示為「某年報酬」。
