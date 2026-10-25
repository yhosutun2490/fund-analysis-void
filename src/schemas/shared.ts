// 多個端點共用的契約。資源專屬的請求/回應 schema 在同目錄下各資源的檔案。
import { z } from "zod";
import { DISCLAIMER } from "../disclaimer";

/** 每個成功回應都帶的免責聲明（逐字固定）。 */
export const disclaimer = z.literal(DISCLAIMER);

/** handler 自己回的錯誤（404/502）的一致形狀。 */
export const ErrorResponse = z.strictObject({ error: z.string() });

/**
 * 請求驗證失敗（400）:Void withValidator 的標準形狀,無法自訂。
 * zh-TW 錯誤用語在 issues[].issues[].message;schema 層級 refine 的錯誤 path 為空字串。
 */
export const ValidationErrorResponse = z.strictObject({
  error: z.literal("Validation failed"),
  issues: z.array(
    z.strictObject({
      slot: z.enum(["query", "params", "body"]),
      issues: z.array(z.strictObject({ message: z.string(), path: z.string().optional() })),
    }),
  ),
});
