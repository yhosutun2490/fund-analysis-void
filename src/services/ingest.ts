import { fetchAllFunds, fetchInvestmentAreaMap, normalize } from "../anue";
import type { Env } from "../bindings";
import { recordRun, updateInvestmentAreas, upsertRecords } from "../repositories/ingest";

/**
 * 主抓取後建立投資區域對照並寫入。
 * 任一區域查詢失敗（或整段拋出）只回傳 note、不更新區域欄,絕不讓 ingest 失敗。
 */
async function ingestAreas(env: Env): Promise<string | undefined> {
  try {
    const { areaOf, warnings, errors } = await fetchInvestmentAreaMap();
    if (errors.length > 0) return `投資區域部分失敗,本次未更新區域欄: ${errors.join("; ")}`;
    await updateInvestmentAreas(env.DB, areaOf);
    return warnings.length > 0 ? `投資區域警告: ${warnings.join("; ")}` : undefined;
  } catch (e) {
    return `投資區域抓取失敗,本次未更新區域欄: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** 抓取 → 正規化 → 寫入 D1 → 記錄執行結果（cron 與手動觸發共用） */
export async function runIngest(env: Env) {
  const started = new Date().toISOString();
  const pageSize = Number(env.ANUE_PAGE_SIZE ?? "2000");
  try {
    const { rows, dataTime, dataCount } = await fetchAllFunds(pageSize);
    const records = rows.map(normalize);
    const upserted = await upsertRecords(env.DB, records);
    const note = await ingestAreas(env);
    const finished = new Date().toISOString();
    await recordRun(env.DB, {
      started_at: started, finished_at: finished, data_time: dataTime,
      total_count: dataCount, upserted, status: "ok", note,
    });
    return { status: "ok", dataTime, dataCount, fetched: rows.length, upserted, note };
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
