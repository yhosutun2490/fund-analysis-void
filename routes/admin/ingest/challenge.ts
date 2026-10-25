// POST /admin/ingest/challenge:要求手動觸發抓取的驗證碼,寄到 session 使用者自己的 email。
import { defineHandler } from "void";
import { endpoints } from "../../../src/schemas/endpoints";
import { issue } from "../../../src/services/challenge";
import { responds } from "../../../src/lib/validation";

export const POST = responds(
  endpoints["POST /admin/ingest/challenge"].responses,
  defineHandler(async (c) => {
    // admin guard 已擋下未登入;這裡只是讓型別收斂
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) return c.json({ error: "unauthorized" }, 401);

    const sent = await issue(c.env, user, session, "ingest");
    if (sent.status === "cooldown") {
      return c.json({ error: "cooldown", retryAfter: sent.retryAfter }, 429, { "Retry-After": String(sent.retryAfter) });
    }
    if (sent.status === "resend_too_soon") {
      return c.json({ error: sent.status, retryAfter: sent.retryAfter }, 429, { "Retry-After": String(sent.retryAfter) });
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
