export interface Env {
  DB: D1Database;
  ANUE_PAGE_SIZE?: string;
  /** cron ingest 失敗/warning 的 Discord 通知;以 secret 設定,未設定即停用。 */
  DISCORD_WEBHOOK_URL?: string;
}
