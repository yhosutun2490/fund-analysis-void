// POST /admin/ingest:帶 email 驗證碼手動觸發抓取（與 cron 同一流程）。
// 驗證碼由 POST /admin/ingest/challenge 寄出;檢查順序:guard（middleware）→ body 驗證 → 觸發冷卻 → 驗證碼（challenge service）。
import { defineHandler } from "void";
import { endpoints } from "../../src/schemas/endpoints";
import { consume } from "../../src/services/challenge";
import { runIngest } from "../../src/services/ingest";
import { guardedSession, tooManyRequests } from "../../src/lib/admin";
import { responds } from "../../src/lib/validation";

const endpoint = endpoints["POST /admin/ingest"];

export const POST = responds(
  endpoint.responses,
  defineHandler.withValidator({ body: endpoint.body })(async (c, { body }) => {
    const { session } = guardedSession(c);

    const challenge = await consume(c.env, session, "ingest", body.code);
    if (challenge.status === "cooldown") return tooManyRequests(c, challenge.status, challenge.retryAfter);
    if (challenge.status === "mismatch") {
      return c.json({ error: "code_mismatch", attemptsLeft: challenge.attemptsLeft }, 422);
    }
    if (challenge.status !== "ok") return c.json({ error: "challenge_invalid" }, 422);

    try {
      return c.json(await runIngest(c.env));
    } catch (e) {
      return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
    }
  }),
);
