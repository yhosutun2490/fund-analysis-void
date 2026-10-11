-- 基金風險分析 D1 schema（自用/內部工具）
-- 來源：鉅亨買基金 Search/Detail，資料帶 lipperid（理柏授權）—— 僅供內部分析，勿對外轉載。

-- 基金基本資料（每檔一列，每次抓取覆蓋更新）
CREATE TABLE IF NOT EXISTS funds (
  fund_id      TEXT PRIMARY KEY,   -- 鉅亨代碼，如 A07212
  isin         TEXT,               -- 跨來源對照 key
  lipper_id    INTEGER,
  name         TEXT NOT NULL,
  fund_group   TEXT,               -- 股票型/債券型...
  category     TEXT,               -- lippertW2_CHI，如 台灣股票
  currency     TEXT,               -- fundCcyCode
  domicile     TEXT,               -- 'onshore'(A) / 'offshore'(B)（由代碼推斷）
  investment_area TEXT,            -- 投資區域（全球/亞洲/北美洲…），以 InvestmentArea 篩選反查建立
  rr           TEXT,               -- RR1..RR5
  esg_score    REAL,
  setup_date   TEXT,
  aum_twd      REAL,               -- fundtnA_TWD
  updated_at   TEXT NOT NULL       -- 最後抓取時間 (ISO)
);
CREATE INDEX IF NOT EXISTS idx_funds_group    ON funds(fund_group);
CREATE INDEX IF NOT EXISTS idx_funds_category ON funds(category);
CREATE INDEX IF NOT EXISTS idx_funds_rr       ON funds(rr);
CREATE INDEX IF NOT EXISTS idx_funds_area     ON funds(investment_area);

-- 風險指標快照（(fund_id, as_of) 為 key，每月累積一筆 —— 這是鉅亨不會給你的歷史）
CREATE TABLE IF NOT EXISTS fund_risk (
  fund_id      TEXT NOT NULL,
  as_of        TEXT NOT NULL,      -- dataTime，風險指標資料截至日（月更）
  -- 口徑：*MEJ = 月底基準；夏普為「月報酬口徑、未年化」，勿與年化夏普混比
  std_1y       REAL,              -- 年化標準差(%)
  sharpe_1y    REAL,
  sharpe_3y    REAL,
  sharpe_5y    REAL,
  sharpe_10y   REAL,
  ret_3m       REAL,              -- perF_3MMEJ 近3個月報酬(%)，月底基準
  ret_6m       REAL,              -- perF_6MMEJ 近6個月報酬(%)，月底基準
  ret_1y       REAL,              -- perF_1YMEJ (%)
  ret_3y       REAL,              -- perF_3YMEJ (%)
  ret_5y       REAL,              -- perF_5YMEJ (%)
  roi_y1       REAL,              -- year_ROI1 近1年度報酬(%)
  roi_y2       REAL,
  roi_y3       REAL,
  roi_y4       REAL,
  roi_y5       REAL,
  maxdrop_y1   REAL,              -- year_MaxQuoteChange1 近1年度最大跌幅(%)
  maxdrop_y2   REAL,
  maxdrop_y3   REAL,
  maxdrop_y4   REAL,
  maxdrop_y5   REAL,
  lipper_total TEXT,              -- llsRatings
  nav          REAL,
  nav_date     TEXT,
  ingested_at  TEXT NOT NULL,
  PRIMARY KEY (fund_id, as_of)
);
CREATE INDEX IF NOT EXISTS idx_risk_asof ON fund_risk(as_of);

-- 每次抓取的紀錄（稽核用）
CREATE TABLE IF NOT EXISTS ingest_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  data_time   TEXT,               -- 回傳的 dataTime
  total_count INTEGER,            -- dataCount
  upserted    INTEGER,
  status      TEXT,               -- ok / error
  note        TEXT
);
