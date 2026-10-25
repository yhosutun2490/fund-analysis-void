// 端點契約登錄表:每個端點的摘要與請求/回應 schema。路由檔從這裡取 schema 驗證,
// GET /openapi.json 從這裡產生文件,兩者同源。文件端點本身（GET /、GET /openapi.json）不登錄。
import type { Endpoint } from "../lib/openapi";
import { AdminIngestError, AdminIngestOk } from "./admin";
import { CategoriesResponse, RunsResponse } from "./meta";

export const endpoints = {
  "POST /admin/ingest": {
    summary: "手動觸發抓取（與 cron 同一流程）",
    tag: "admin",
    responses: { 200: AdminIngestOk, 500: AdminIngestError },
  },
  "GET /api/meta/categories": {
    summary: "各類別/類型的基金數",
    tag: "meta",
    responses: { 200: CategoriesResponse },
  },
  "GET /api/meta/runs": {
    summary: "ingest 執行紀錄",
    tag: "meta",
    responses: { 200: RunsResponse },
  },
} as const satisfies Record<string, Endpoint>;
