import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailTestHarness, type EmailTestHarness } from "void/email/testing";

vi.mock("../src/services/ingest", () => ({ runIngest: vi.fn() }));
vi.mock("../src/repositories/challenges", async () => (await import("./fakes/challenge-repository")).fakeChallengeRepository);

import { request, signedInAs } from "./entry";
import { resetFakeChallenges } from "./fakes/challenge-repository";
import { runIngest } from "../src/services/ingest";
import { ValidationErrorResponse } from "../src/schemas/shared";

const ADMIN = "admin@example.com";
const env = { DB: {} as D1Database, ADMIN_EMAILS: ADMIN };

let inbox: EmailTestHarness;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  resetFakeChallenges();
  inbox = createEmailTestHarness();
});

afterEach(() => {
  inbox.dispose();
  vi.useRealTimers();
});

const okRun = { status: "ok", dataTime: "2026-10-22", dataCount: 1, fetched: 1, upserted: 1, note: undefined } as const;

const requestChallenge = (auth = signedInAs(ADMIN)) =>
  request("/admin/ingest/challenge", { method: "POST" }, env, auth);

const trigger = (body: unknown, auth = signedInAs(ADMIN)) =>
  request(
    "/admin/ingest",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
    auth,
  );

/** 最新一封驗證信裡的 6 位數碼。 */
function latestCode(): string {
  const text = inbox.messages.at(-1)?.text ?? "";
  const match = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (!match) throw new Error(`信中找不到驗證碼:${text}`);
  return match[1];
}

/** 同一個使用者的另一個 session(例如另一台電腦登入)。 */
function otherSession() {
  const auth = signedInAs(ADMIN);
  return { ...auth, session: { ...auth.session!, id: "other-session", token: "other-token" } };
}

/** 一定不等於 code 的另一組 6 位數碼。 */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("POST /admin/ingest/challenge — 要求驗證碼", () => {
  it("202 { status: sent, expiresAt, resendAfter },寄一封純文字信給 session 使用者,內含 6 位數碼且無連結", async () => {
    const res = await requestChallenge();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      status: "sent",
      expiresAt: "2026-10-25T00:10:00.000Z",
      resendAfter: "2026-10-25T00:01:00.000Z",
    });

    expect(inbox.messages).toHaveLength(1);
    const [mail] = inbox.messages;
    expect(mail.to.map((t) => t.email)).toEqual([ADMIN]);
    expect(mail.subject).toContain("手動觸發抓取驗證碼");
    expect(mail.html).toBeUndefined();
    const text = mail.text ?? "";
    expect(text).toMatch(/(?<!\d)\d{6}(?!\d)/);
    // 到期時間以台灣時間呈現(UTC 00:10 = 台灣 08:10)
    expect(text).toContain("2026-10-25 08:10");
    expect(text).toContain("台灣時間");
    expect(text).toContain("若非本人操作，請立即更改密碼");
    expect(text).not.toMatch(/https?:|www\.|\/\//i);
  });
});

describe("POST /admin/ingest — 帶驗證碼觸發", () => {
  beforeEach(() => {
    vi.mocked(runIngest).mockReset();
    vi.mocked(runIngest).mockResolvedValue(okRun);
  });

  it("正確碼 → 200 並執行抓取一次;同碼再用 → 422 challenge_invalid", async () => {
    await requestChallenge();
    const code = latestCode();

    const first = await trigger({ code });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "ok", dataTime: "2026-10-22", dataCount: 1, fetched: 1, upserted: 1 });
    expect(runIngest).toHaveBeenCalledOnce();

    const again = await trigger({ code });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ error: "challenge_invalid" });
    expect(runIngest).toHaveBeenCalledOnce();
  });

  it("超過 10 分鐘 → challenge_invalid;到期前一刻仍可用", async () => {
    await requestChallenge();
    const code = latestCode();

    vi.setSystemTime(new Date("2026-10-25T00:10:00Z"));
    const expired = await trigger({ code });
    expect(expired.status).toBe(422);
    expect(await expired.json()).toEqual({ error: "challenge_invalid" });

    await requestChallenge();
    vi.setSystemTime(new Date("2026-10-25T00:19:59.999Z"));
    expect((await trigger({ code: latestCode() })).status).toBe(200);
    expect(runIngest).toHaveBeenCalledOnce();
  });

  it("有效時間可用 CHALLENGE_TTL_SECONDS 覆寫", async () => {
    const res = await request("/admin/ingest/challenge", { method: "POST" }, { ...env, CHALLENGE_TTL_SECONDS: "120" }, signedInAs(ADMIN));
    expect(await res.json()).toMatchObject({ expiresAt: "2026-10-25T00:02:00.000Z" });
  });

  it("重新要求後舊碼 → challenge_invalid,新碼可用", async () => {
    await requestChallenge();
    const oldCode = latestCode();
    vi.setSystemTime(new Date("2026-10-25T00:02:00Z"));
    await requestChallenge();
    const newCode = latestCode();
    // 極小機率兩次產生同一組碼;那樣舊碼就無從區分
    expect(newCode).not.toBe(oldCode);

    const old = await trigger({ code: oldCode });
    expect(old.status).toBe(422);
    expect(await old.json()).toEqual({ error: "challenge_invalid" });

    expect((await trigger({ code: newCode })).status).toBe(200);
    expect(runIngest).toHaveBeenCalledOnce();
  });

  it("同一帳號的別的 session 拿這組碼 → challenge_invalid,原 session 仍可用", async () => {
    await requestChallenge();
    const code = latestCode();

    const other = await trigger({ code }, otherSession());
    expect(other.status).toBe(422);
    expect(await other.json()).toEqual({ error: "challenge_invalid" });
    expect(runIngest).not.toHaveBeenCalled();

    expect((await trigger({ code })).status).toBe(200);
  });

  it("從未要求驗證碼 → challenge_invalid", async () => {
    const res = await trigger({ code: "123456" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "challenge_invalid" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it.each([
    ["缺 code", {}],
    ["5 位數", { code: "12345" }],
    ["7 位數", { code: "1234567" }],
    ["非數字", { code: "12a456" }],
    ["數字型別", { code: 123456 }],
  ])("body %s → 400 ValidationErrorResponse,不執行抓取,碼仍可用", async (_, body) => {
    await requestChallenge();
    const res = await trigger(body);
    expect(res.status).toBe(400);
    expect(ValidationErrorResponse.parse(await res.json())).toEqual({
      error: "Validation failed",
      issues: [{ slot: "body", issues: [{ message: "code 須為 6 位數字", path: "code" }] }],
    });
    expect(runIngest).not.toHaveBeenCalled();

    expect((await trigger({ code: latestCode() })).status).toBe(200);
  });

  it.each([
    ["沒有 body", undefined],
    ["不是 JSON", "code=123456"],
  ])("%s → 400 { error: Invalid JSON body },不執行抓取", async (_, body) => {
    await requestChallenge();
    const res = await request("/admin/ingest", { method: "POST", body }, env, signedInAs(ADMIN));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("兩個並發請求帶同一組正確碼 → 恰好一個 200、一個 422,只抓取一次", async () => {
    await requestChallenge();
    const code = latestCode();

    const statuses = (await Promise.all([trigger({ code }), trigger({ code })])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 422]);
    expect(runIngest).toHaveBeenCalledOnce();
  });

  it("碼不符 → 422,不執行抓取", async () => {
    await requestChallenge();
    const res = await trigger({ code: wrongCode(latestCode()) });
    expect(res.status).toBe(422);
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("抓取失敗 → 500 { status: error, message }", async () => {
    vi.mocked(runIngest).mockRejectedValue(new Error("Anue HTTP 500"));
    await requestChallenge();
    const res = await trigger({ code: latestCode() });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: "error", message: "Anue HTTP 500" });
  });
});

describe("未登入/非管理員(guard 在前)", () => {
  it.each([
    ["未登入", undefined, 401, "unauthorized"],
    ["非管理員", signedInAs("guest@example.com"), 403, "forbidden"],
  ] as const)("%s要求驗證碼 → %i,不寄信", async (_, auth, status, error) => {
    const res = await request("/admin/ingest/challenge", { method: "POST" }, env, auth);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(inbox.messages).toHaveLength(0);
  });

  it.each([
    ["未登入", undefined, 401, "unauthorized"],
    ["非管理員", signedInAs("guest@example.com"), 403, "forbidden"],
  ] as const)("%s帶碼觸發 → %i,不執行抓取", async (_, auth, status, error) => {
    await requestChallenge();
    const res = await request(
      "/admin/ingest",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: latestCode() }) },
      env,
      auth,
    );
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(runIngest).not.toHaveBeenCalled();
  });
});
