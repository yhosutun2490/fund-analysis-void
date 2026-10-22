// 路由請求驗證的共用件（zod + @hono/zod-validator）。各路由的輸入契約定義在各自的路由檔。
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";

/** 驗證失敗 → 400 { error },訊息取第一個 issue（schema 內已寫好 zh-TW 用語:參數名 + 有效範圍/允許值）。 */
export const validate = <T extends keyof ValidationTargets, S extends z.ZodType>(target: T, schema: S) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? "請求參數不合法" }, 400);
  });

/** 數值參數：非數值或超出 [lo, hi] → `${name} 須為 lo–hi 的數值`。 */
export const rangeNum = (name: string, lo: number, hi: number) => {
  const error = `${name} 須為 ${lo}–${hi} 的數值`;
  return z.coerce.number({ error }).min(lo, { error }).max(hi, { error });
};

/** 非負整數參數（limit/offset 類）。 */
export const nonNegInt = (name: string) => {
  const error = `${name} 須為非負整數`;
  return z.coerce.number({ error }).int({ error }).min(0, { error });
};

/** 任意有限數值參數（門檻類）。 */
export const finiteNum = (name: string) => z.coerce.number({ error: `${name} 須為數值` });

/** 逗號分隔 → 去空白、濾空。 */
export const splitCsv = (raw: string) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** 多值篩選參數：逗號分隔、去空白、濾空;無值（含只有逗號/空白）→ undefined。 */
export const csvList = z
  .string()
  .optional()
  .transform((raw) => {
    const xs = raw === undefined ? [] : splitCsv(raw);
    return xs.length ? xs : undefined;
  });

/** 空字串視同未給（如 GET / 端點範本中的 `minSharpe3y=`）。 */
export const blankAsMissing = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

/** YYYY-MM-DD 日期參數。 */
export const isoDate = (name: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: `${name} 須為 YYYY-MM-DD` });
