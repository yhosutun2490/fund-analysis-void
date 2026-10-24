// 路由的請求驗證（validate）與回應驗證（responds）middleware。各端點的請求/回應 schema 在 src/schemas/*。
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { describeIssues } from "./zodIssues";

/** 驗證失敗 → 400 { error },訊息取第一個 issue（schema 內已寫好 zh-TW 用語:參數名 + 有效範圍/允許值）。 */
export const validate = <T extends keyof ValidationTargets, S extends z.ZodType>(target: T, schema: S) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? "請求參數不合法" }, 400);
  });

/**
 * 回應驗證：依狀態碼對 JSON 回應套 schema。違反自身 schema 屬 server bug:
 * - 非正式（vite dev / vitest）→ fail-closed:丟錯 → 500,讓漂移上線前就現形。
 * - 正式（vite build）→ fail-open:記錄違規但照常回傳,內部不符不變成使用者可見的中斷。
 * 須放在路由 middleware 的第一個,才包得住請求驗證產生的 400。
 */
export const responds = (schemas: Partial<Record<number, z.ZodType>>) =>
  createMiddleware(async (c, next) => {
    await next();
    const schema = schemas[c.res.status];
    if (!schema || !c.res.headers.get("content-type")?.includes("application/json")) return;
    const r = schema.safeParse(await c.res.clone().json());
    if (r.success) return;
    const msg = `response schema mismatch ${c.req.method} ${c.req.routePath} ${c.res.status}: ${describeIssues(r.error)}`;
    if (!import.meta.env.PROD) throw new Error(msg);
    console.error(msg);
  });
