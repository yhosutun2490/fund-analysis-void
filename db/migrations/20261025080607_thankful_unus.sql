CREATE TABLE `admin_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`used_at` text,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_challenges_session` ON `admin_challenges` (`session_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `idx_challenges_used` ON `admin_challenges` (`purpose`,`used_at`);