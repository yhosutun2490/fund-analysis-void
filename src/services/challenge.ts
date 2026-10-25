// 觸發驗證（ingest challenge）:管理員動作前,先寄 email 驗證碼、帶碼才放行。
// 路由只負責 HTTP 形狀;有效期、比對、作廢、單次使用等規則都在這裡,DB 存取在 src/repositories/challenges.ts。
import { sendEmail } from "void/email";
import type { Env } from "../bindings";
import { EMAIL_FROM } from "../lib/email";
import { findActiveChallenge, findLatestRevokedChallenge, findLatestUse, markChallengeUsed, replaceActiveChallenge } from "../repositories/challenges";
// 防濫用:重寄間隔、錯誤次數上限
import { latestChallengeCreatedAt, recordFailedAttempt } from "../repositories/challenges";

/** 驗證碼保護的管理員動作。目前只有 ingest;資料表的 purpose 欄保留擴充。 */
export type ChallengePurpose = "ingest";

/** 發碼對象:session 使用者（收件人固定為其 email,不接受請求指定）與發碼的 session。 */
export interface ChallengeUser {
  id: string;
  email: string;
}
export interface ChallengeSession {
  id: string;
}

/** 觸發冷卻中:retryAfter 為剩餘秒數。 */
export type Cooldown = { status: "cooldown"; retryAfter: number };
export type IssueResult =
  | { status: "sent"; expiresAt: Date; resendAfter: Date }
  | Cooldown
  /** 距上次發碼未滿重寄間隔;retryAfter 為還要等的秒數（無條件進位）。 */
  | { status: "resend_too_soon"; retryAfter: number }
  /** 寄信失敗,沒有寫入驗證碼;reason 為供應商錯誤代碼,只供記錄。 */
  | { status: "send_failed"; reason: string };
export type ConsumeResult =
  | { status: "ok" }
  | { status: "invalid" }
  | Cooldown
  /** 碼不符;attemptsLeft 為 0 表示這次錯滿、驗證碼已作廢。 */
  | { status: "mismatch"; attemptsLeft: number };

const SUBJECT_ACTION: Record<ChallengePurpose, string> = { ingest: "手動觸發抓取" };

/** 正整數 env var;未設定或不合法即用預設值。 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : fallback;
}

/** 正整數 env var（秒）→ 毫秒;未設定或不合法即用預設值。 */
function seconds(raw: string | undefined, fallback: number): number {
  return positiveInt(raw, fallback) * 1000;
}

/** 參數預設值,可用 env var 覆寫。 */
function settings(env: Env) {
  return {
    /** 驗證碼有效時間 */
    ttlMs: seconds(env.CHALLENGE_TTL_SECONDS, 600),
    /** 重寄間隔（回應的 resendAfter） */
    resendMs: seconds(env.CHALLENGE_RESEND_SECONDS, 60),
    /** 觸發冷卻:最近一次使用驗證碼後多久內不能再要求或觸發 */
    cooldownMs: seconds(env.CHALLENGE_COOLDOWN_SECONDS, 600),
    /** 最多錯誤嘗試次數,錯滿即作廢 */
    maxAttempts: positiveInt(env.CHALLENGE_MAX_ATTEMPTS, 5),
  };
}

/**
 * 觸發冷卻:同 purpose 最近一次使用驗證碼（= 手動觸發開始）後 cooldownMs 內,回傳剩餘秒數（無條件進位）;
 * 不在冷卻中則 null。全域生效,不分使用者與 session;cron 不經驗證碼,不算進冷卻。
 */
async function cooldownRemaining(env: Env, purpose: ChallengePurpose, now: Date): Promise<number | null> {
  const latest = await findLatestUse(env.DB, { purpose });
  if (!latest) return null;
  const remainingMs = new Date(latest.usedAt).getTime() + settings(env).cooldownMs - now.getTime();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null;
}

/** 均勻分布的 6 位數字（含前導 0）:拒絕取樣,避免 2^32 mod 10^6 造成的偏差。 */
function generateCode(): string {
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/** 儲存與比對用的雜湊:hex(SHA-256(challenge id + ":" + code))。 */
async function hashCode(challengeId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${challengeId}:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 台灣時間（UTC+8,無日光節約）,如 2026-10-25 08:10。 */
const taipeiTime = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

/** 純文字信:驗證碼、到期時間（台灣時間）、非本人操作的提醒;不放任何連結。 */
function challengeMail(purpose: ChallengePurpose, code: string, expiresAt: Date) {
  const action = SUBJECT_ACTION[purpose];
  return {
    subject: `[fund-risks-analysis] ${action}驗證碼`,
    text: [
      `您要求的${action}驗證碼為:`,
      "",
      `    ${code}`,
      "",
      `有效期限至 ${taipeiTime(expiresAt)}（台灣時間），只能使用一次。`,
      "",
      "若非本人操作，請立即更改密碼。",
    ].join("\n"),
  };
}

/**
 * 發一組新驗證碼寄給 session 使用者:觸發冷卻 → 重寄間隔 → 產生驗證碼 → 寄信 → 寄信成功才寫入（同時作廢同 session 的舊碼）。
 * 冷卻中 → cooldown、未滿重寄間隔 → resend_too_soon,都不寄信。寄信失敗不留下可用的碼,也不占用重寄間隔。
 */
export async function issue(
  env: Env,
  user: ChallengeUser,
  session: ChallengeSession,
  purpose: ChallengePurpose,
): Promise<IssueResult> {
  const now = new Date();
  const { ttlMs, resendMs } = settings(env);

  // 觸發冷卻:冷卻中不寄一封註定用不到的信
  const cooldown = await cooldownRemaining(env, purpose, now);
  if (cooldown !== null) return { status: "cooldown", retryAfter: cooldown };

  // 重寄間隔:以使用者計,距上次成功發碼未滿 resendMs 就不寄信
  const lastCreatedAt = await latestChallengeCreatedAt(env.DB, { userId: user.id, purpose });
  if (lastCreatedAt) {
    const waitMs = Date.parse(lastCreatedAt) + resendMs - now.getTime();
    if (waitMs > 0) return { status: "resend_too_soon", retryAfter: Math.ceil(waitMs / 1000) };
  }

  const id = crypto.randomUUID();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const sent = await sendEmail({ from: EMAIL_FROM, to: user.email, ...challengeMail(purpose, code, expiresAt) });
  if (!sent.ok) {
    const reason = "error" in sent ? sent.error.code : sent.deliveries.map((d) => (d.ok ? "ok" : d.error.code)).join(",");
    return { status: "send_failed", reason };
  }

  await replaceActiveChallenge(env.DB, {
    id,
    purpose,
    userId: user.id,
    sessionId: session.id,
    codeHash: await hashCode(id, code),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  return { status: "sent", expiresAt, resendAfter: new Date(now.getTime() + resendMs) };
}

/**
 * 以驗證碼換取一次動作許可。檢查順序:觸發冷卻 → 目前有效的驗證碼 → 比對雜湊 → 條件式標記已使用（含冷卻條件）。
 * 冷卻中 → cooldown（不比對、不消耗碼）;
 * 沒有有效的碼（過期、已用、已作廢、錯滿、從未要求、別的 session 發的）→ invalid;
 * 碼不符但等於同 session 上一組已作廢的碼（重新要求後的舊碼）→ invalid,不累加嘗試次數;
 * 其他碼不符 → 累加嘗試次數（錯滿即作廢）→ mismatch;
 * 標記已使用時被並發請求搶先 → 同一組碼 invalid,別組碼搶先開始冷卻 → cooldown。只有 ok 才可以執行動作。
 */
export async function consume(
  env: Env,
  session: ChallengeSession,
  purpose: ChallengePurpose,
  code: string,
): Promise<ConsumeResult> {
  const now = new Date().toISOString();

  // 觸發冷卻:先於驗證碼檢查,冷卻中不比對、不消耗碼（冷卻開始前就要的有效碼也一樣）
  const cooldown = await cooldownRemaining(env, purpose, new Date(now));
  if (cooldown !== null) return { status: "cooldown", retryAfter: cooldown };

  const { maxAttempts } = settings(env);
  const challenge = await findActiveChallenge(env.DB, { sessionId: session.id, purpose, now, maxAttempts });
  if (!challenge) return { status: "invalid" };

  if ((await hashCode(challenge.id, code)) !== challenge.codeHash) {
    // 重新要求後送來的舊碼:不是猜錯,回 invalid,不消耗新碼的嘗試次數
    const previous = await findLatestRevokedChallenge(env.DB, { sessionId: session.id, purpose });
    if (previous && (await hashCode(previous.id, code)) === previous.codeHash) return { status: "invalid" };

    const attempts = await recordFailedAttempt(env.DB, { id: challenge.id, maxAttempts, now });
    // 比對期間被並發請求用掉或作廢
    if (attempts === null) return { status: "invalid" };
    return { status: "mismatch", attemptsLeft: Math.max(0, maxAttempts - attempts) };
  }

  const cooldownSince = new Date(Date.parse(now) - settings(env).cooldownMs).toISOString();
  const marked = await markChallengeUsed(env.DB, { id: challenge.id, now, cooldownSince });
  if (marked) return { status: "ok" };

  // 標記失敗:這組碼被並發請求搶先使用 → invalid;別組碼搶先開始觸發 → cooldown（這組碼不被消耗）
  const latest = await findLatestUse(env.DB, { purpose });
  if (latest && latest.id !== challenge.id) {
    const retryAfter = await cooldownRemaining(env, purpose, new Date(now));
    if (retryAfter !== null) return { status: "cooldown", retryAfter };
  }
  return { status: "invalid" };
}
