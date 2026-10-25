import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // test/entry.ts 用 import.meta.glob 讀 routes/ 與 middleware/;檔案系統的模組快取
    // 以檔案內容為 key,新增/刪除路由檔不會讓它失效,測試會拿到過期的路由表。
    fsModuleCache: false,
  },
});
