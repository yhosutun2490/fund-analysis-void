// npm run ingest:local:登入後手動觸發一次抓取(POST /admin/ingest)。
//
// /admin/* 有守門,直接 POST 會拿到 401,所以分兩步:
//   1. curl POST /api/auth/sign-in/email(帶 Origin)→ session cookie 存進 cookie jar
//   2. curl 帶 cookie jar POST /admin/ingest
//
// 帳密只從 shell 環境變數讀(不要寫進 package.json、.env 或任何 commit 的檔案):
//   ADMIN_LOGIN_EMAIL     已註冊的管理員 email(須在 .env 的 ADMIN_EMAILS 內)
//   ADMIN_LOGIN_PASSWORD  該帳號的密碼
//   INGEST_BASE_URL       選填,預設 http://localhost:5173
//
// 例(Git Bash):ADMIN_LOGIN_EMAIL=me@example.com ADMIN_LOGIN_PASSWORD='...' npm run ingest:local
//
// cookie jar 放在 OS 暫存目錄,結束時刪除,不會出現在 repo 裡。
// 用 Node 包 curl 而不是 shell 一行:npm 在 Windows 預設走 cmd.exe,且密碼要正確 JSON 編碼;
// request body 由 stdin 傳給 curl,密碼不會出現在行程參數列。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = (process.env.INGEST_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, "");

/**
 * 呼叫 curl,回傳 { status, body }。
 * Origin 一律設為 baseUrl:Void 對非 GET 請求會檢查 Origin,外來或缺漏時忽略 session cookie。
 */
function curl(path, { jar, saveCookies = false, json } = {}) {
  const args = ["-sS", "-X", "POST", `${baseUrl}${path}`, "-H", `Origin: ${baseUrl}`, "-w", "\n%{http_code}"];
  if (jar) args.push(saveCookies ? "-c" : "-b", jar);
  if (json !== undefined) args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
  const out = execFileSync("curl", args, {
    input: json === undefined ? undefined : JSON.stringify(json),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  const cut = out.lastIndexOf("\n");
  return { status: Number(out.slice(cut + 1)), body: out.slice(0, cut) };
}

/** 以 email/密碼登入,session cookie 寫進 jar;失敗即丟錯。 */
function signIn(jar, { email, password }) {
  const res = curl("/api/auth/sign-in/email", { jar, saveCookies: true, json: { email, password } });
  if (res.status !== 200) throw new Error(`登入失敗(HTTP ${res.status}):${res.body}`);
}

/** 帶 jar 內的 session 觸發抓取,回傳 { status, body }。 */
function triggerIngest(jar) {
  return curl("/admin/ingest", { jar });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少環境變數 ${name}(見 scripts/ingest-local.mjs 開頭說明)`);
    process.exit(1);
  }
  return value;
}

const credentials = { email: requireEnv("ADMIN_LOGIN_EMAIL"), password: requireEnv("ADMIN_LOGIN_PASSWORD") };
const dir = mkdtempSync(join(tmpdir(), "ingest-local-"));
const jar = join(dir, "cookies.txt");
try {
  signIn(jar, credentials);
  const res = triggerIngest(jar);
  console.log(res.body);
  if (res.status < 200 || res.status >= 300) {
    console.error(`POST /admin/ingest 回 HTTP ${res.status}`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
