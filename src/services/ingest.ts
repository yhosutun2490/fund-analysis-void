import { fetchAllFunds, normalize } from "../anue";
import type { Env } from "../env";
import { recordRun, upsertRecords } from "../repositories/ingest";

/** 抓取 → 正規化 → 寫入 D1 → 記錄執行結果（cron 與手動觸發共用） */
export async function runIngest(env: Env) {
  const started = new Date().toISOString();
  const pageSize = Number(env.ANUE_PAGE_SIZE ?? "2000");
  try {
    const { rows, dataTime, dataCount } = await fetchAllFunds(pageSize);
    const records = rows.map(normalize);
    const upserted = await upsertRecords(env.DB, records);
    const finished = new Date().toISOString();
    await recordRun(env.DB, {
      started_at: started, finished_at: finished, data_time: dataTime,
      total_count: dataCount, upserted, status: "ok",
    });
    return { status: "ok", dataTime, dataCount, fetched: rows.length, upserted };
  } catch (e) {
    const finished = new Date().toISOString();
    const note = e instanceof Error ? e.message : String(e);
    await recordRun(env.DB, {
      started_at: started, finished_at: finished, data_time: null,
      total_count: 0, upserted: 0, status: "error", note,
    });
    throw e;
  }
}
