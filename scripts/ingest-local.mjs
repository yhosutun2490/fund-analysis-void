// npm run ingest:local:登入、取得 email 驗證碼後手動觸發一次抓取(POST /admin/ingest)。只用於本機 vite dev。
//
// /admin/* 有守門,且觸發要帶 email 驗證碼,所以分四步:
//   1. curl POST /api/auth/sign-in/email(帶 Origin)→ session cookie 存進 cookie jar
//   2. curl 帶 cookie jar POST /admin/ingest/challenge → 驗證碼寄到管理員 email
//      (本機 vite dev 不會真的寄出,而是進 Void 的本機 inbox /__void/inbox)
//   3. 帶 x-void-dev-trigger(.void/dev-trigger-token)從 /__void/inbox 取最新一封信,解析出 6 位數驗證碼
//   4. curl 帶 cookie jar 與 { code } POST /admin/ingest
//
// 帳密只從 shell 環境變數讀(不要寫進 package.json、.env 或任何 commit 的檔案):
//   ADMIN_LOGIN_EMAIL     已註冊的管理員 email(須在 .env 的 ADMIN_EMAILS 內)
//   ADMIN_LOGIN_PASSWORD  該帳號的密碼
//   INGEST_BASE_URL       選填,預設 http://localhost:5173(須是本機 vite dev,才有 /__void/inbox)
//
// 例(Git Bash):ADMIN_LOGIN_EMAIL=me@example.com ADMIN_LOGIN_PASSWORD='...' npm run ingest:local
//
// cookie jar 放在 OS 暫存目錄,結束時刪除,不會出現在 repo 裡。
// 用 Node 包 curl 而不是 shell 一行:npm 在 Windows 預設走 cmd.exe,且密碼要正確 JSON 編碼;
// request body 由 stdin 傳給 curl,密碼不會出現在行程參數列。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = (process.env.INGEST_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, "");

/** vite dev 啟動時寫入的本機 inbox 存取 token。 */
const DEV_TRIGGER_TOKEN_FILE = new URL("../.void/dev-trigger-token", import.meta.url);

/**
 * 呼叫 curl,回傳 { status, body }。
 * Origin 一律設為 baseUrl:Void 對非 GET 請求會檢查 Origin,外來或缺漏時忽略 session cookie。
 */
function curl(path, { method = "POST", jar, saveCookies = false, json, headers = {} } = {}) {
  const args = ["-sS", "-X", method, `${baseUrl}${path}`, "-H", `Origin: ${baseUrl}`, "-w", "\n%{http_code}"];
  for (const [name, value] of Object.entries(headers)) args.push("-H", `${name}: ${value}`);
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

/** 帶 jar 內的 session 要求驗證碼(寄到該管理員的 email);失敗即丟錯。 */
function requestChallenge(jar) {
  const res = curl("/admin/ingest/challenge", { jar });
  if (res.status !== 202) throw new Error(`要求驗證碼失敗(HTTP ${res.status}):${res.body}`);
}

function readDevTriggerToken() {
  try {
    return readFileSync(DEV_TRIGGER_TOKEN_FILE, "utf8").trim();
  } catch {
    throw new Error("找不到 .void/dev-trigger-token:請先在本 repo 啟動 npm run dev(本機 inbox 只在 vite dev 提供)");
  }
}

/** 從本機 inbox 最新一封信解析出 6 位數驗證碼。inbox 只提供 HTML 頁面:列表最新在前,信件頁的 <pre> 是純文字內文。 */
function latestInboxCode(token) {
  const inbox = (path) => {
    const res = curl(`/__void/inbox${path}`, { method: "GET", headers: { "x-void-dev-trigger": token } });
    if (res.status !== 200) throw new Error(`讀取本機 inbox 失敗(HTTP ${res.status}):${res.body}`);
    return res.body;
  };
  const id = inbox("/").match(/href="\/__void\/inbox\/([^"/?]+)\?/)?.[1];
  if (!id) throw new Error("本機 inbox 沒有信件");
  const text = inbox(`/${encodeURIComponent(id)}`).match(/<pre>([\s\S]*?)<\/pre>/)?.[1] ?? "";
  const code = text.match(/^\s*(\d{6})\s*$/m)?.[1];
  if (!code) throw new Error(`最新一封信中找不到驗證碼:${text}`);
  return code;
}

/** 帶 jar 內的 session 與驗證碼觸發抓取,回傳 { status, body }。 */
function triggerIngest(jar, code) {
  return curl("/admin/ingest", { jar, json: { code } });
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
  const token = readDevTriggerToken();
  signIn(jar, credentials);
  requestChallenge(jar);
  const res = triggerIngest(jar, latestInboxCode(token));
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
