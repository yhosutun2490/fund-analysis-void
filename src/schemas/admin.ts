// /admin/ingest（帶碼觸發）與 /admin/ingest/challenge（要求驗證碼）的請求/回應契約。
import { z } from "zod";

/** POST /admin/ingest 的 body:email 收到的 6 位數驗證碼。 */
export const AdminIngestBody = z.object({
  code: z
    .string({ error: "code 須為 6 位數字" })
    .regex(/^\d{6}$/, { error: "code 須為 6 位數字" })
    .meta({ description: "POST /admin/ingest/challenge 寄到管理員信箱的 6 位數驗證碼", examples: ["012345"] }),
});

/** 驗證碼已寄出（ISO 時間字串）:驗證碼到期時間、可再次要求的時間。 */
export const ChallengeSent = z.strictObject({
  status: z.literal("sent"),
  expiresAt: z.iso.datetime(),
  resendAfter: z.iso.datetime(),
});

/** 距上次要求驗證碼未滿重寄間隔,沒有寄信:retryAfter 為還要等的秒數（同 Retry-After 標頭）。 */
export const ResendTooSoon = z.strictObject({
  error: z.literal("resend_too_soon"),
  retryAfter: z.number().int().positive(),
});

/** 沒有有效的驗證碼:過期、已使用、已作廢、從未要求,或不是這個 session 要求的。 */
export const ChallengeInvalid = z.strictObject({ error: z.literal("challenge_invalid") });

/** 驗證碼不符:attemptsLeft 為剩餘可嘗試次數;0 表示這次錯滿、驗證碼已作廢,須重新要求。 */
export const CodeMismatch = z.strictObject({
  error: z.literal("code_mismatch"),
  attemptsLeft: z.number().int().nonnegative(),
});

export const AdminIngestOk = z.strictObject({
  status: z.literal("ok"),
  dataTime: z.string(),
  dataCount: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  upserted: z.number().int().nonnegative(),
  note: z.string().optional(),
});

export const AdminIngestError = z.strictObject({ status: z.literal("error"), message: z.string() });
