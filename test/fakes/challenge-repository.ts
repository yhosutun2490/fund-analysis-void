// src/repositories/challenges 的 in-memory 替身(以 vi.mock 換掉真的 repository)。
// 忠實實作同一介面的語意,尤其「條件式標記已使用」:只有 used_at 仍為空(且未作廢)才更新,
// 並發的兩個請求只會有一個拿到 true。
import type * as Repo from "../../src/repositories/challenges";
import type { Challenge } from "../../src/repositories/challenges";

const rows = new Map<string, Challenge>();

/** 測試間清空。 */
export function resetFakeChallenges() {
  rows.clear();
}

/** 讓 microtask 交錯:真的 D1 呼叫是非同步的,並發請求會在每次存取間交錯執行。 */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

export const fakeChallengeRepository = {
  async replaceActiveChallenge(_db, challenge) {
    await tick();
    for (const row of rows.values()) {
      if (row.sessionId === challenge.sessionId && row.purpose === challenge.purpose && !row.usedAt && !row.revokedAt) {
        row.revokedAt = challenge.createdAt;
      }
    }
    rows.set(challenge.id, { revokedAt: null, usedAt: null, attempts: 0, ...challenge });
  },

  async findActiveChallenge(_db, { sessionId, purpose, now }) {
    await tick();
    const active = [...rows.values()]
      .filter((r) => r.sessionId === sessionId && r.purpose === purpose && !r.revokedAt && !r.usedAt && r.expiresAt > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return active[0] ? { ...active[0] } : null;
  },

  async findLatestUse(_db, { purpose }) {
    await tick();
    const used = [...rows.values()]
      .filter((r): r is Challenge & { usedAt: string } => r.purpose === purpose && !!r.usedAt)
      .sort((a, b) => b.usedAt.localeCompare(a.usedAt));
    return used[0] ? { id: used[0].id, usedAt: used[0].usedAt } : null;
  },

  async markChallengeUsed(_db, { id, now, cooldownSince }) {
    await tick();
    const row = rows.get(id);
    if (!row || row.usedAt || row.revokedAt) return false;
    // 觸發冷卻併在同一個條件裡:同 purpose 在 cooldownSince 之後已有驗證碼被使用 → 不更新
    if ([...rows.values()].some((r) => r.purpose === row.purpose && r.usedAt && r.usedAt > cooldownSince)) return false;
    row.usedAt = now;
    return true;
  },

  async latestChallengeCreatedAt(_db, { userId, purpose }) {
    await tick();
    const created = [...rows.values()]
      .filter((r) => r.userId === userId && r.purpose === purpose)
      .map((r) => r.createdAt)
      .sort();
    return created.at(-1) ?? null;
  },

  async recordFailedAttempt(_db, { id, maxAttempts, now }) {
    await tick();
    const row = rows.get(id);
    if (!row || row.usedAt || row.revokedAt) return null;
    row.attempts += 1;
    if (row.attempts >= maxAttempts) row.revokedAt = now;
    return row.attempts;
  },
} satisfies typeof Repo;
