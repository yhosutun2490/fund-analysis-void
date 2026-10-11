-- 既有 DB 升級：fund_risk 新增近 3 個月 / 6 個月報酬欄位,funds 新增投資區域
-- 全新建庫請用 schema.sql（已含這些欄位）
ALTER TABLE fund_risk ADD COLUMN ret_3m REAL;  -- perF_3MMEJ 近3個月報酬(%)，月底基準
ALTER TABLE fund_risk ADD COLUMN ret_6m REAL;  -- perF_6MMEJ 近6個月報酬(%)，月底基準

ALTER TABLE funds ADD COLUMN investment_area TEXT;  -- 投資區域（InvestmentArea 篩選反查）
CREATE INDEX IF NOT EXISTS idx_funds_area ON funds(investment_area);

-- 含息序列快取（回復分析）
CREATE TABLE IF NOT EXISTS fund_series (
  fund_id        TEXT PRIMARY KEY,
  basis          TEXT NOT NULL,
  series_start   TEXT NOT NULL,
  series_end     TEXT NOT NULL,
  points         TEXT NOT NULL,
  fetched_at     TEXT NOT NULL,
  mdd                    REAL,
  mdd_recovered          INTEGER,
  mdd_underwater_days    INTEGER,
  still_underwater_ratio REAL,
  loss_prob_1y           REAL
);
