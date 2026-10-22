// cron ingest 的 Discord 主動通知（盡力而為,不是資料管線的一部分）。
// 只在無人看守的 cron 路徑使用;手動 /admin/ingest 呼叫者已同步看到結果,不送。

const DISCORD_LIMIT = 2000;
const SERVICE = "fund-risks-analysis";

/** runIngest 的結果中通知需要的部分。 */
export interface IngestOutcome {
  status: string;
  dataTime?: string;
  upserted?: number;
  note?: string;
}

/** 乾淨成功 → null（不送）;帶 warning → 🟡;失敗另見 ingestFailureMessage。 */
export function ingestWarningMessage(r: IngestOutcome): string | null {
  if (!r.note) return null;
  return `🟡 ${SERVICE} cron ingest 完成但有 warning\nstatus: ${r.status} · dataTime: ${r.dataTime ?? "-"} · upserted: ${r.upserted ?? "-"}\n${r.note}`;
}

export function ingestFailureMessage(e: unknown): string {
  return `🔴 ${SERVICE} cron ingest 失敗\nstatus: error\n${e instanceof Error ? e.message : String(e)}`;
}

/** 截到 Discord 上限;若切在代理對中間（如 emoji）則再退一格。 */
function truncate(s: string): string {
  const cut = s.slice(0, DISCORD_LIMIT);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** POST 到 Discord webhook。未設定 → 安靜略過;任何失敗只記 log,絕不拋出。 */
export async function notifyDiscord(webhookUrl: string | undefined, content: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: truncate(content) }),
    });
    if (!res.ok) console.error("discord notify failed", res.status);
  } catch (e) {
    console.error("discord notify failed", e);
  }
}
