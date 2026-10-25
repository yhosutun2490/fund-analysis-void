// 「是否為管理員」:唯一的授權判斷來源(/admin/* 守門與註冊限制共用);以及 /admin/* 路由共用的小工具。
// auth.ts 經 Node 直接載入本檔:只能有 type-only 的外部 import。
import type { CloudContext } from "void";
import type { Env } from "../bindings";

const normalize = (email: string) => email.trim().toLowerCase();

/**
 * email 是否在 ADMIN_EMAILS(逗號分隔)允許清單內。比對前 trim、轉小寫;
 * 清單未設定或為空時一律 false(fail-closed)。
 */
export function isAdmin(env: Pick<Env, "ADMIN_EMAILS">, email: string): boolean {
  const target = normalize(email);
  if (!target) return false;
  return (env.ADMIN_EMAILS ?? "").split(",").some((entry) => normalize(entry) === target);
}

/**
 * admin guard(middleware/02.admin-guard.ts)保證進到 /admin/* 路由時已登入;這裡取出 user/session 並收斂型別。
 * 拿不到代表 guard 沒生效(設定錯誤):丟錯 → 500,不放行。
 */
export function guardedSession(c: CloudContext) {
  const user = c.get("user");
  const session = c.get("session");
  if (!user || !session) throw new Error("admin guard 未生效:/admin/* 路由拿不到登入 session");
  return { user, session };
}

/** 429 + Retry-After:body 的 retryAfter(秒)與標頭同值。 */
export function tooManyRequests<E extends string>(c: CloudContext, error: E, retryAfter: number) {
  return c.json({ error, retryAfter }, 429, { "Retry-After": String(retryAfter) });
}
