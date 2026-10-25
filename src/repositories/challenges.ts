// admin_challenges（觸發驗證的驗證碼）的 DB 存取。規則（有效期、比對、次數）在 src/services/challenge.ts。
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { makeDb } from "../db/client";
import { adminChallenges } from "../../db/schema";

export type Challenge = typeof adminChallenges.$inferSelect;
/** 新發的驗證碼:作廢/使用時間與嘗試次數由 DB 預設（空、空、0）。 */
export type NewChallenge = Pick<Challenge, "id" | "purpose" | "userId" | "sessionId" | "codeHash" | "createdAt" | "expiresAt">;

/** 同 session、同 purpose 仍未使用、未作廢的列。 */
const openFor = (sessionId: string, purpose: string) =>
  and(
    eq(adminChallenges.sessionId, sessionId),
    eq(adminChallenges.purpose, purpose),
    isNull(adminChallenges.usedAt),
    isNull(adminChallenges.revokedAt),
  );

/**
 * 寫入新驗證碼,並把同 session、同 purpose 舊的未使用驗證碼標為作廢（作廢時間 = 新碼建立時間）。
 * 兩者在同一個 D1 batch（單一交易）內,同一時間只會有一組有效。
 */
export async function replaceActiveChallenge(db: D1Database, challenge: NewChallenge): Promise<void> {
  const drizzle = makeDb(db);
  await drizzle.batch([
    drizzle.update(adminChallenges).set({ revokedAt: challenge.createdAt }).where(openFor(challenge.sessionId, challenge.purpose)),
    drizzle.insert(adminChallenges).values(challenge),
  ]);
}

/** 目前有效的驗證碼:同 session、同 purpose 最新一筆未作廢、未使用、未過期（expires_at > now）者;沒有則 null。 */
export async function findActiveChallenge(
  db: D1Database,
  { sessionId, purpose, now }: { sessionId: string; purpose: string; now: string },
): Promise<Challenge | null> {
  const [row] = await makeDb(db)
    .select()
    .from(adminChallenges)
    .where(and(openFor(sessionId, purpose), gt(adminChallenges.expiresAt, now)))
    .orderBy(desc(adminChallenges.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * 條件式標記已使用:只有使用時間仍為空（且未作廢）才更新。
 * 回傳是否由這次呼叫標記成功（影響 1 列）;並發的兩個請求只有一個拿到 true。
 */
export async function markChallengeUsed(db: D1Database, { id, now }: { id: string; now: string }): Promise<boolean> {
  const result = await makeDb(db)
    .update(adminChallenges)
    .set({ usedAt: now })
    .where(and(eq(adminChallenges.id, id), isNull(adminChallenges.usedAt), isNull(adminChallenges.revokedAt)))
    .run();
  return result.meta.changes === 1;
}

/**
 * 該使用者、該 purpose 最近一次發出驗證碼的時間（不論後來已用、作廢或過期）;從未發過則 null。
 * 重寄間隔的依據:只有寄信成功才會寫入,所以寄信失敗不占用重寄間隔。
 * 以使用者（收件人）而非 session 計,換個 session 也不能灌爆同一個信箱。
 */
export async function latestChallengeCreatedAt(
  db: D1Database,
  { userId, purpose }: { userId: string; purpose: string },
): Promise<string | null> {
  const [row] = await makeDb(db)
    .select({ createdAt: adminChallenges.createdAt })
    .from(adminChallenges)
    .where(and(eq(adminChallenges.userId, userId), eq(adminChallenges.purpose, purpose)))
    .orderBy(desc(adminChallenges.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * 記一次錯誤嘗試:attempts + 1,達 maxAttempts 即同時作廢（作廢時間 = now）。
 * 同一個 UPDATE 以 DB 端的原值計算,並發的錯誤嘗試不會互相覆蓋,也不會多給機會。
 * 只對仍未使用、未作廢的列生效;回傳累加後的次數,該列已被使用/作廢則 null。
 */
export async function recordFailedAttempt(
  db: D1Database,
  { id, maxAttempts, now }: { id: string; maxAttempts: number; now: string },
): Promise<number | null> {
  const [row] = await makeDb(db)
    .update(adminChallenges)
    .set({
      attempts: sql`${adminChallenges.attempts} + 1`,
      revokedAt: sql`CASE WHEN ${adminChallenges.attempts} + 1 >= ${maxAttempts} THEN ${now} ELSE NULL END`,
    })
    .where(and(eq(adminChallenges.id, id), isNull(adminChallenges.usedAt), isNull(adminChallenges.revokedAt)))
    .returning({ attempts: adminChallenges.attempts });
  return row?.attempts ?? null;
}
