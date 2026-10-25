// 端點契約登錄表:每個端點的摘要與請求/回應 schema。路由檔從這裡取 schema 驗證,
// GET /openapi.json 從這裡產生文件,兩者同源。文件端點本身（GET /、GET /openapi.json）不登錄。
import { z } from "zod";
import type { Endpoint } from "../lib/openapi";
import { AdminIngestBody, AdminIngestError, AdminIngestOk, ChallengeInvalid, ChallengeSent } from "./admin";
import { CodeMismatch, ResendTooSoon } from "./admin";
import {
  FundDetailResponse,
  FundHistoryResponse,
  FundIdParam,
  FundListQuery,
  FundListResponse,
  RecoveryQuery,
  RecoveryResponse,
} from "./funds";
import { CategoriesResponse, RunsResponse } from "./meta";
import { ScreenQuery, ScreenResponse } from "./screen";
import { ErrorResponse, InvalidJsonBodyResponse, ValidationErrorResponse } from "./shared";

export const endpoints = {
  "POST /admin/ingest/challenge": {
    summary: "要求手動觸發抓取的驗證碼（寄到登入管理員的 email）",
    description: "驗證碼 6 位數字、有效 10 分鐘、只能用一次,綁定發出它的 session。重新要求時舊碼作廢。同一管理員 60 秒內只能要求一次（429 resend_too_soon）。",
    tag: "admin",
    auth: "session",
    // 401/403 由 admin guard middleware 回應（不經 responds()）,列進契約是為了文件。
    responses: {
      202: ChallengeSent,
      401: ErrorResponse,
      403: ErrorResponse,
      429: ResendTooSoon,
    },
  },
  "POST /admin/ingest": {
    summary: "帶驗證碼手動觸發抓取（與 cron 同一流程）",
    description: "先以 POST /admin/ingest/challenge 要求驗證碼。驗證碼正確才執行抓取;驗證碼用過即失效。錯 5 次即作廢,須重新要求;body 格式錯（400）不消耗嘗試次數。",
    tag: "admin",
    auth: "session",
    body: AdminIngestBody,
    responses: {
      200: AdminIngestOk,
      400: z.union([ValidationErrorResponse, InvalidJsonBodyResponse]),
      401: ErrorResponse,
      403: ErrorResponse,
      422: z.union([CodeMismatch, ChallengeInvalid]),
      500: AdminIngestError,
    },
  },
  "GET /api/funds": {
    summary: "基金清單 + 篩選 + 排序（以最新快照）",
    tag: "funds",
    query: FundListQuery,
    responses: { 200: FundListResponse, 400: ValidationErrorResponse },
  },
  "GET /api/funds/:id": {
    summary: "單檔基本資料 + 最新快照",
    tag: "funds",
    params: FundIdParam,
    responses: { 200: FundDetailResponse, 400: ValidationErrorResponse, 404: ErrorResponse },
  },
  "GET /api/funds/:id/history": {
    summary: "單檔風險歷史（cron 累積出來的月序列）",
    tag: "funds",
    params: FundIdParam,
    responses: { 200: FundHistoryResponse, 400: ValidationErrorResponse },
  },
  "GET /api/funds/:id/recovery": {
    summary: "單檔回復分析（含息序列的最大回撤、回撤事件、單筆投入與近期報酬）",
    description: "from 不可晚於 to。窗口內有效點少於 60 個時,指標回 null 並標 reason: series_too_short。",
    tag: "funds",
    params: FundIdParam,
    query: RecoveryQuery,
    responses: { 200: RecoveryResponse, 400: ValidationErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
  },
  "GET /api/screen": {
    summary: "快照初篩:範圍篩選決定回傳哪些基金,百分位永遠以完整 (category, currency) 組計算",
    description: "category / area / group 至少擇一（決定篩選範圍）。同組 = 同 category + 同 currency。",
    tag: "screen",
    query: ScreenQuery,
    responses: { 200: ScreenResponse, 400: ValidationErrorResponse },
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
