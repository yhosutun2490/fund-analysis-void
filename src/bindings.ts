export interface Env {
  DB: D1Database;
  ANUE_PAGE_SIZE?: string;
  /** cron ingest 失敗/warning 的 Discord 通知;以 secret 設定,未設定即停用。 */
  DISCORD_WEBHOOK_URL?: string;
  /** 管理員 email 允許清單(逗號分隔);以 secret 設定,未設定即沒有任何管理員。 */
  ADMIN_EMAILS?: string;
  /** 觸發驗證碼有效秒數,預設 600。 */
  CHALLENGE_TTL_SECONDS?: string;
  /** 重新要求驗證碼的最短間隔秒數,預設 60。 */
  CHALLENGE_RESEND_SECONDS?: string;
  /** 觸發驗證碼最多錯誤嘗試次數,錯滿即作廢,預設 5。 */
  CHALLENGE_MAX_ATTEMPTS?: string;
}
