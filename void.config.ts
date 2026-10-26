import { defineConfig } from "void/config";
// 帶 .ts 副檔名:void CLI 以 Node 原生 import 載入本檔,不會補副檔名
import { EMAIL_FROM } from "./src/lib/email.ts";

// 排程由 crons/ 底下的檔案宣告;路由由 routes/ 的檔案定義(一個 URL 一個檔);全域 middleware 在 middleware/。
export default defineConfig({
  // 驗證碼信件的寄件者（直接部署到自有 Cloudflare 帳號時必填）。目前是佔位值,見 src/lib/email.ts。
  email: { from: EMAIL_FROM },
  cloudflare: {
    name: "fund-risks-analysis",
    compatibility_date: "2024-12-18",
    d1_databases: [
      {
        binding: "DB",
        database_name: "fund_risks",
        // 建立：wrangler d1 create fund_risks  → 把回傳的 database_id 填進來
        database_id: "REPLACE_WITH_YOUR_D1_DATABASE_ID",
        // 沿用 drizzle-kit generate 產生的 migration 目錄
        migrations_dir: "db/migrations",
      },
    ],
    vars: {
      // 自用工具：抓取頻率低、僅供內部分析。詳見 docs/research/2026-10-10-anue-fund-search-api.md
      ANUE_PAGE_SIZE: "2000",
    },
  },
});
