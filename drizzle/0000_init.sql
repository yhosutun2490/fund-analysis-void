CREATE TABLE `fund_risk` (
	`fund_id` text NOT NULL,
	`as_of` text NOT NULL,
	`std_1y` real,
	`sharpe_1y` real,
	`sharpe_3y` real,
	`sharpe_5y` real,
	`sharpe_10y` real,
	`ret_3m` real,
	`ret_6m` real,
	`ret_1y` real,
	`ret_3y` real,
	`ret_5y` real,
	`roi_y1` real,
	`roi_y2` real,
	`roi_y3` real,
	`roi_y4` real,
	`roi_y5` real,
	`maxdrop_y1` real,
	`maxdrop_y2` real,
	`maxdrop_y3` real,
	`maxdrop_y4` real,
	`maxdrop_y5` real,
	`lipper_total` text,
	`nav` real,
	`nav_date` text,
	`ingested_at` text NOT NULL,
	PRIMARY KEY(`fund_id`, `as_of`)
);
--> statement-breakpoint
CREATE INDEX `idx_risk_asof` ON `fund_risk` (`as_of`);--> statement-breakpoint
CREATE TABLE `fund_series` (
	`fund_id` text PRIMARY KEY NOT NULL,
	`basis` text NOT NULL,
	`series_start` text NOT NULL,
	`series_end` text NOT NULL,
	`points` text NOT NULL,
	`fetched_at` text NOT NULL,
	`mdd` real,
	`mdd_recovered` integer,
	`mdd_underwater_days` integer,
	`still_underwater_ratio` real,
	`loss_prob_1y` real
);
--> statement-breakpoint
CREATE TABLE `funds` (
	`fund_id` text PRIMARY KEY NOT NULL,
	`isin` text,
	`lipper_id` integer,
	`name` text NOT NULL,
	`fund_group` text,
	`category` text,
	`currency` text,
	`domicile` text,
	`investment_area` text,
	`rr` text,
	`esg_score` real,
	`setup_date` text,
	`aum_twd` real,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_funds_group` ON `funds` (`fund_group`);--> statement-breakpoint
CREATE INDEX `idx_funds_category` ON `funds` (`category`);--> statement-breakpoint
CREATE INDEX `idx_funds_rr` ON `funds` (`rr`);--> statement-breakpoint
CREATE INDEX `idx_funds_area` ON `funds` (`investment_area`);--> statement-breakpoint
CREATE TABLE `ingest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`data_time` text,
	`total_count` integer,
	`upserted` integer,
	`status` text,
	`note` text
);
