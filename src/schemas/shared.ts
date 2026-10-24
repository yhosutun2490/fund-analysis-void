// 多個端點共用的契約。資源專屬的請求/回應 schema 在同目錄下各資源的檔案。
import { z } from "zod";
import { DISCLAIMER } from "../disclaimer";

/** 每個成功回應都帶的免責聲明（逐字固定）。 */
export const disclaimer = z.literal(DISCLAIMER);

/** 請求錯誤（400/404/502）的一致形狀。 */
export const ErrorResponse = z.strictObject({ error: z.string() });
