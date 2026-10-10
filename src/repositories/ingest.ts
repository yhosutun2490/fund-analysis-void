import type { FundRecord } from "../anue";

/** 把一批正規化記錄寫入 D1。funds 覆蓋更新；fund_risk 以 (fund_id, as_of) upsert 累積月歷史。 */
export async function upsertRecords(db: D1Database, records: FundRecord[]): Promise<number> {
  const now = new Date().toISOString();

  const fundStmt = db.prepare(
    `INSERT INTO funds (fund_id, isin, lipper_id, name, fund_group, category, currency, domicile, rr, esg_score, setup_date, aum_twd, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
     ON CONFLICT(fund_id) DO UPDATE SET
       isin=?2, lipper_id=?3, name=?4, fund_group=?5, category=?6, currency=?7, domicile=?8,
       rr=?9, esg_score=?10, setup_date=?11, aum_twd=?12, updated_at=?13`,
  );

  const riskStmt = db.prepare(
    `INSERT INTO fund_risk (fund_id, as_of, std_1y, sharpe_1y, sharpe_3y, sharpe_5y, sharpe_10y,
       ret_1y, ret_3y, ret_5y, roi_y1, roi_y2, roi_y3, roi_y4, roi_y5,
       maxdrop_y1, maxdrop_y2, maxdrop_y3, maxdrop_y4, maxdrop_y5, lipper_total, nav, nav_date, ingested_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
     ON CONFLICT(fund_id, as_of) DO UPDATE SET
       std_1y=?3, sharpe_1y=?4, sharpe_3y=?5, sharpe_5y=?6, sharpe_10y=?7,
       ret_1y=?8, ret_3y=?9, ret_5y=?10, roi_y1=?11, roi_y2=?12, roi_y3=?13, roi_y4=?14, roi_y5=?15,
       maxdrop_y1=?16, maxdrop_y2=?17, maxdrop_y3=?18, maxdrop_y4=?19, maxdrop_y5=?20,
       lipper_total=?21, nav=?22, nav_date=?23, ingested_at=?24`,
  );

  const batch: D1PreparedStatement[] = [];
  let upserted = 0;
  for (const rec of records) {
    const f = rec.fund;
    batch.push(
      fundStmt.bind(
        f.fund_id, f.isin, f.lipper_id, f.name, f.fund_group, f.category, f.currency,
        f.domicile, f.rr, f.esg_score, f.setup_date, f.aum_twd, now,
      ),
    );
    // 沒有資料截至日就跳過風險快照（不得以空值佔位）
    if (rec.risk.as_of) {
      const k = rec.risk;
      batch.push(
        riskStmt.bind(
          f.fund_id, k.as_of, k.std_1y, k.sharpe_1y, k.sharpe_3y, k.sharpe_5y, k.sharpe_10y,
          k.ret_1y, k.ret_3y, k.ret_5y, k.roi_y1, k.roi_y2, k.roi_y3, k.roi_y4, k.roi_y5,
          k.maxdrop_y1, k.maxdrop_y2, k.maxdrop_y3, k.maxdrop_y4, k.maxdrop_y5,
          k.lipper_total, k.nav, k.nav_date, now,
        ),
      );
      upserted++;
    }
  }

  // D1 batch 一次上限較小，分塊送
  const CHUNK = 50;
  for (let i = 0; i < batch.length; i += CHUNK) {
    await db.batch(batch.slice(i, i + CHUNK));
  }
  return upserted;
}

export async function recordRun(
  db: D1Database,
  run: { started_at: string; finished_at: string; data_time: string | null; total_count: number; upserted: number; status: string; note?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ingest_runs (started_at, finished_at, data_time, total_count, upserted, status, note)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`,
    )
    .bind(run.started_at, run.finished_at, run.data_time, run.total_count, run.upserted, run.status, run.note ?? null)
    .run();
}

export async function listRuns(db: D1Database) {
  const { results } = await db
    .prepare("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 20")
    .all();
  return results;
}
