import type { Env } from "../bindings";
import { ingestFailureMessage, ingestWarningMessage, notifyDiscord } from "../notify";
import { runIngest } from "../services/ingest";

/** Cron Trigger：與手動 /admin/ingest 共用 runIngest 流程;失敗或帶 warning 時通知 Discord */
export function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
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
}
