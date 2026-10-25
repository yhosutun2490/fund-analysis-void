// POST /admin/ingest/challenge:要求手動觸發抓取的驗證碼,寄到 session 使用者自己的 email。
import { defineHandler } from "void";
import { endpoints } from "../../../src/schemas/endpoints";
import { issue } from "../../../src/services/challenge";
import { guardedSession, tooManyRequests } from "../../../src/lib/admin";
import { responds } from "../../../src/lib/validation";

export const POST = responds(
  endpoints["POST /admin/ingest/challenge"].responses,
  defineHandler(async (c) => {
    const { user, session } = guardedSession(c);

    const sent = await issue(c.env, user, session, "ingest");
    if (sent.status === "cooldown" || sent.status === "resend_too_soon") {
      return tooManyRequests(c, sent.status, sent.retryAfter);
    }
    if (sent.status === "send_failed") {
      console.error("challenge email send failed", sent.reason);
      return c.json({ error: "email_send_failed" }, 502);
    }
    return c.json(
      { status: sent.status, expiresAt: sent.expiresAt.toISOString(), resendAfter: sent.resendAfter.toISOString() },
      202,
    );
  }),
);
