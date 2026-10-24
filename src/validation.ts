// 路由的回應驗證（responds）。請求驗證由各路由檔的 defineHandler.withValidator() 負責;各端點的請求/回應 schema 在 src/schemas/*。
import type { CloudContext } from "void";
import { convertReturnValue } from "void/response";
import type { z } from "zod";
import { describeIssues } from "./zodIssues";

/**
 * 回應驗證：依狀態碼對 JSON 回應套 schema。違反自身 schema 屬 server bug:
 * - 非正式（vite dev / vitest）→ fail-closed:丟錯 → 500,讓漂移上線前就現形。
 * - 正式（vite build）→ fail-open:記錄違規但照常回傳,內部不符不變成使用者可見的中斷。
 *
 * 寫成包住 handler 的高階函式,不是 middleware:`defineHandler(middleware, handler)` 的型別一律回
 * `TypedHandler<{}, ...>`,會把 withValidator 推導出的 query/params 型別抹掉,typed fetch 就推不出輸入型別。
 * 這裡原樣回傳 handler 的型別。包在 withValidator 產生的 handler 外面,才包得住請求驗證產生的 400。
 */
export const responds =
  <H extends (c: CloudContext) => unknown>(schemas: Partial<Record<number, z.ZodType>>, handler: H): H =>
  (async (c: CloudContext) => {
    const res = convertReturnValue(await handler(c));
    const schema = schemas[res.status];
    if (!schema || !res.headers.get("content-type")?.includes("application/json")) return res;
    const r = schema.safeParse(await res.clone().json());
    if (r.success) return res;
    const msg = `response schema mismatch ${c.req.method} ${c.req.routePath} ${res.status}: ${describeIssues(r.error)}`;
    if (!import.meta.env.PROD) throw new Error(msg);
    console.error(msg);
    return res;
  }) as H;
