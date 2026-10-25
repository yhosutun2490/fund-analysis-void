// POST /admin/ingest:帶 email 驗證碼手動觸發抓取（與 cron 同一流程）。
// 驗證碼由 POST /admin/ingest/challenge 寄出;檢查順序:guard（middleware）→ body 驗證 → 驗證碼（challenge service）。
import { defineHandler } from "void";
import { endpoints } from "../../src/schemas/endpoints";
import { consume } from "../../src/services/challenge";
import { runIngest } from "../../src/services/ingest";
import { responds } from "../../src/lib/validation";

const endpoint = endpoints["POST /admin/ingest"];

export const POST = responds(
  endpoint.responses,
  defineHandler.withValidator({ body: endpoint.body })(async (c, { body }) => {
    // admin guard 已擋下未登入;這裡只是讓型別收斂
    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);

    const challenge = await consume(c.env, session, "ingest", body.code);
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
