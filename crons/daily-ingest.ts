import { defineScheduled } from "void";
import type { Env } from "../src/bindings";
import { ingestFailureMessage, ingestWarningMessage, notifyDiscord } from "../src/lib/notify";
import { runIngest } from "../src/services/ingest";

// 每天台灣時間早上 7:00 抓一次（UTC 23:00）。風險指標月更、淨值日更，一天一次足夠。
export const cron = "0 23 * * *";

/** 與手動 /admin/ingest 共用 runIngest 流程;失敗或帶 warning 時通知 Discord */
export default defineScheduled((_controller, env: Env, ctx) => {
  ctx.waitUntil(
    runIngest(env).then(
      async (r) => {
        console.log("ingest ok", JSON.stringify(r));
        const msg = ingestWarningMessage(r);
        if (msg) await notifyDiscord(env.DISCORD_WEBHOOK_URL, msg);
      },
      async (e) => {
        console.error("ingest failed", e);
        await notifyDiscord(env.DISCORD_WEBHOOK_URL, ingestFailureMessage(e));
      },
    ),
  );
});
