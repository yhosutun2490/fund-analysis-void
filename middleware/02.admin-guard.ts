import { defineMiddleware } from "void";
import type { Env } from "../src/bindings";
import { isAdmin } from "../src/lib/admin";

const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

/**
 * /admin 與 /admin/* 的守門:只有管理員(已登入且 email 在 ADMIN_EMAILS 內)能呼叫。
 * user 由 Void auth middleware 放進 context(排在所有使用者 middleware 之前)。
 * 不用 requireAuth:它丟的 HTTPException 回純文字,與既有 { error } 錯誤契約不一致。
 * 跨 origin 的 POST 不會帶上 session(Void 忽略 cookie)→ 這裡看到未登入 → 401,即 CSRF 防護。
 */
export default defineMiddleware(async (c, next) => {
  if (!isAdminPath(c.req.path)) return next();
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const env: Env = c.env;
  if (!isAdmin(env, user.email)) return c.json({ error: "forbidden" }, 403);
  return next();
});
