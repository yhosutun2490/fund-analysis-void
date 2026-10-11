-- 既有 DB 升級：fund_risk 新增近 3 個月 / 6 個月報酬欄位
-- 全新建庫請用 schema.sql（已含這些欄位）
ALTER TABLE fund_risk ADD COLUMN ret_3m REAL;  -- perF_3MMEJ 近3個月報酬(%)，月底基準
ALTER TABLE fund_risk ADD COLUMN ret_6m REAL;  -- perF_6MMEJ 近6個月報酬(%)，月底基準
