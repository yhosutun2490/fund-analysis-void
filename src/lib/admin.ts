// 「是否為管理員」:唯一的授權判斷來源(/admin/* 守門與註冊限制共用)。
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
