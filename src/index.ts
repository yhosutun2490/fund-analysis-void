import { app } from "./app";
import type { Env } from "./env";
import { runIngest } from "./services/ingest";

export default {
  fetch: app.fetch,
  // Cron Trigger（Task 3 會抽到 triggers/scheduled.ts）
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runIngest(env).then(
      (r) => console.log("ingest ok", JSON.stringify(r)),
      (e) => console.error("ingest failed", e),
    ));
  },
};
