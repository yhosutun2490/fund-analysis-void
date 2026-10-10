# Wrangler 學習筆記

Wrangler 是 Cloudflare 開發者平台的官方 CLI，負責本地開發、打包、部署與資源管理。
框架（Next.js、Astro、SvelteKit…）靠各自的 adapter 轉換輸出，最後仍由 Wrangler 執行與部署。

設定檔：`wrangler.jsonc`（新專案建議）或 `wrangler.toml`。以下範例用 jsonc。
> 細節以官方文件為準：https://developers.cloudflare.com/workers/wrangler/configuration/

## 常用指令

```bash
npm i -D wrangler
npx wrangler login                 # 瀏覽器授權
npx wrangler dev                   # 本地開發
npx wrangler deploy                # 部署
npx wrangler tail                  # 看線上 log
npx wrangler secret put KEY        # 設定機密
npx wrangler types                 # 依設定產生 TypeScript 型別
```

## 01 核心設定（必學）

| 欄位 | 說明 |
|---|---|
| `name` | Worker 名稱，也決定預設網址 `<name>.<subdomain>.workers.dev` |
| `main` | 進入點檔案，例如 `src/index.ts`（純靜態網站可省略） |
| `compatibility_date` | 鎖定 Workers runtime 行為的日期，避免平台更新造成破壞 |
| `compatibility_flags` | 啟用額外功能，例如 `["nodejs_compat"]` |

```jsonc
{
  "name": "fund-risks-analysis",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01"
}
```

## 02 網站部署（必學）

| 欄位 | 說明 |
|---|---|
| `assets` | 靜態資源（前端 build 輸出）一起部署 |
| `routes` | 綁定自訂網域或路由 |
| `workers_dev` | 是否啟用 `*.workers.dev` 預設網址 |

```jsonc
{
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application" // SPA 找不到檔案時回 index.html
  },
  "routes": [
    { "pattern": "risks.example.com", "custom_domain": true }
  ],
  "workers_dev": false
}
```

- 自訂網域的 DNS 需在 Cloudflare 管理。
- 要先跑前端 build，`directory` 指向的資料夾才存在。

## 03 環境管理（必學）

| 項目 | 說明 |
|---|---|
| `vars` | 明文環境變數，會進版本控制，不可放機密 |
| secrets | 機密，用 `wrangler secret put` 設定，不寫在設定檔 |
| `env` | 定義 staging、production 等環境，用 `--env` 指定 |

```jsonc
{
  "vars": { "APP_MODE": "dev" },
  "env": {
    "staging": { "name": "fund-risks-staging", "vars": { "APP_MODE": "staging" } },
    "production": { "name": "fund-risks-prod", "vars": { "APP_MODE": "prod" } }
  }
}
```

```bash
npx wrangler deploy --env staging
npx wrangler secret put API_KEY --env staging
```

- 本地機密放 `.dev.vars`（務必加入 `.gitignore`）。
- 注意：`vars` 等部分欄位在 env 內不會繼承，要在每個 env 重新宣告；bindings（D1、KV…）也一樣。

## 04 資料儲存（依需求）

| 欄位 | 服務 | 適合 |
|---|---|---|
| `d1_databases` | D1（SQLite） | 結構化資料、查詢 |
| `kv_namespaces` | KV | 讀多寫少的鍵值、快取 |
| `r2_buckets` | R2 | 檔案、大型物件（相容 S3） |

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "fund-risks", "database_id": "<id>" }
  ],
  "kv_namespaces": [{ "binding": "CACHE", "id": "<id>" }],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "fund-files" }]
}
```

程式內用 `env.DB`、`env.CACHE`、`env.FILES` 存取（`binding` 就是變數名）。

```bash
npx wrangler d1 create fund-risks
npx wrangler d1 execute fund-risks --file=schema.sql
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create fund-files
```

## 05 進階架構（後續）

| 欄位 | 用途 |
|---|---|
| `services` | Worker 之間互相呼叫（service binding） |
| `durable_objects` | 有狀態、需強一致的物件（需搭配 `migrations`） |
| `queues` | 訊息佇列，分 producer 與 consumer |
| `triggers` | 排程，例如 cron：`{ "crons": ["0 1 * * *"] }` |

先用不到，等需求出現再回頭讀。例如定期抓取資料就會用到 `triggers.crons`。

## Worker 的角色（架構模式）

Worker 技術上只有一種，「SPA／公開 API／內部 DB」是由設定決定的角色。

| 角色 | 關鍵設定 | 說明 |
|---|---|---|
| SPA／靜態網站 | `assets`，不用寫 `main` | 只放前端 build 輸出，`not_found_handling: "single-page-application"` 處理前端 route |
| 公開 API | `main`、`routes`（或 `workers_dev`） | 有程式邏輯，對外開放網址，要自己做驗證和 CORS |
| 內部 DB 層 | `d1_databases`、不設 `routes`、`workers_dev: false` | 只有 Worker 能碰資料庫，不開放對外網址 |

### 常見組合

1. **單一 Worker 全包：** `assets` 加 `main`。靜態檔直接回傳，`/api/*` 才進程式。用 `assets.run_worker_first` 指定哪些路徑先進 Worker。小專案最簡單。
2. **前端 Worker 加內部 Worker：** 用 `services`（service binding）呼叫內部 Worker。內部 Worker 沒有公開網址，只有綁定的 Worker 能呼叫。

```jsonc
// 內部 DB Worker：不對外
{
  "name": "fund-db",
  "main": "src/db.ts",
  "workers_dev": false,
  "d1_databases": [{ "binding": "DB", "database_name": "fund-risks", "database_id": "<id>" }]
}

// 公開 API / 前端 Worker：用 service binding 呼叫內部
{
  "name": "fund-web",
  "main": "src/index.ts",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
  "services": [{ "binding": "DB_SERVICE", "service": "fund-db" }]
}
```

### 注意：授權

Anue／Lipper 資料只能私有或內部使用。「API 不公開」可能不夠：只要對外的前端 Worker 回傳資料，資料就等於公開。
建議在前面加 Cloudflare Access（登入驗證）或自己做驗證，並與負責授權的人確認。

## 學習順序

1. 先完成 01～03，把一個 Worker 或靜態網站部署上線。
2. 需要資料庫或檔案時才學 04。
3. 05 等架構變複雜再說。

## 待辦／疑問

- [ ] 本專案要部署什麼？純前端、API、還是兩者
- [ ] 需不需要 D1 或 R2 存資料
- [ ] 資料授權：Anue／Lipper 資料僅限私有／內部使用，部署時不要公開存取
