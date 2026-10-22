import { fetchAllFunds, fetchInvestmentAreaMap, normalize } from "../anue";
import type { Env } from "../bindings";
import { recordRun, updateInvestmentAreas, upsertRecords } from "../repositories/ingest";

/**
 * 主抓取後建立投資區域對照並寫入,回傳要記進 note 的訊息。
 * 任一區域查詢失敗（或整段拋出）只記 note、不更新區域欄,絕不讓 ingest 失敗。
 * 鉅亨加性變動 warning 不論區域成敗一律保留,且不冠「投資區域」字樣。
 */
async function ingestAreas(env: Env): Promise<string[]> {
  try {
    const { areaOf, warnings, errors, upstreamWarnings } = await fetchInvestmentAreaMap();
    if (errors.length > 0) return [...upstreamWarnings, `投資區域部分失敗,本次未更新區域欄: ${errors.join("; ")}`];
    await updateInvestmentAreas(env.DB, areaOf);
    return warnings.length > 0 ? [...upstreamWarnings, `投資區域警告: ${warnings.join("; ")}`] : upstreamWarnings;
  } catch (e) {
    return [`投資區域抓取失敗,本次未更新區域欄: ${e instanceof Error ? e.message : String(e)}`];
  }
}

/** 抓取 → 正規化 → 寫入 D1 → 記錄執行結果（cron 與手動觸發共用） */
export async function runIngest(env: Env) {
  const started = new Date().toISOString();
  const pageSize = Number(env.ANUE_PAGE_SIZE ?? "2000");
  try {
    const { rows, dataTime, dataCount, warnings } = await fetchAllFunds(pageSize);
    const records = rows.map(normalize);
    const upserted = await upsertRecords(env.DB, records);
    // 鉅亨加性變動 warning 與投資區域 warning 並列;皆無 → undefined（乾淨成功）
    const notes = [...warnings, ...(await ingestAreas(env))];
    const note = notes.length ? notes.join("; ") : undefined;
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
