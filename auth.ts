import { defineAuth } from "void/auth";
// 帶 .ts 副檔名:void CLI(db generate 等)以 Node 原生 import 載入本檔,不會補副檔名
import { isAdmin } from "./src/lib/admin.ts";

/**
 * Void auth(Better Auth)設定:只開 email/密碼(Void 預設)。
 * 註冊限制:email 不在 ADMIN_EMAILS 允許清單就拒絕建立 user(與 /admin/* 守門共用 isAdmin)。
 * 不用 disableSignUp:那會連首位管理員都無法註冊。
 * defaults 不會被深層合併,新增設定時要以 ...defaults 為基底。
 */
export default defineAuth(({ defaults, env }) => ({
  ...defaults,
  databaseHooks: {
    user: {
      create: {
        // 回 false 即中止建立;sign-up 回 400(FAILED_TO_CREATE_USER),不透露允許清單
        before: async (user) => {
          const adminEmails = typeof env.ADMIN_EMAILS === "string" ? env.ADMIN_EMAILS : undefined;
          return isAdmin({ ADMIN_EMAILS: adminEmails }, user.email) ? undefined : false;
        },
      },
    },
  },
}));
