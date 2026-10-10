import type { Env } from "../env";
import { runIngest } from "../services/ingest";

/** Cron Trigger：與手動 /admin/ingest 共用 runIngest 流程 */
export function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    runIngest(env).then(
      (r) => console.log("ingest ok", JSON.stringify(r)),
      (e) => console.error("ingest failed", e),
    ),
  );
}
