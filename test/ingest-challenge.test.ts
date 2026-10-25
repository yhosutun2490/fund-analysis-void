import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailTestHarness, type EmailTestHarness } from "void/email/testing";

vi.mock("../src/services/ingest", () => ({ runIngest: vi.fn() }));
vi.mock("../src/repositories/challenges", async () => (await import("./fakes/challenge-repository")).fakeChallengeRepository);
// email harness 只能擷取、無法模擬寄信失敗:sendEmail 預設照常呼叫真的實作(信仍進 harness),
// 只有寄信失敗的情境以 mockResolvedValueOnce 換掉一次。
vi.mock("void/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("void/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

import { request, signedInAs } from "./entry";
import { resetFakeChallenges } from "./fakes/challenge-repository";
import { runIngest } from "../src/services/ingest";
import { sendEmail } from "void/email";
import scheduled from "../crons/daily-ingest";
import { ValidationErrorResponse } from "../src/schemas/shared";

const ADMIN = "admin@example.com";
const OTHER_ADMIN = "other-admin@example.com";
const env = { DB: {} as D1Database, ADMIN_EMAILS: `${ADMIN},${OTHER_ADMIN}` };

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

const requestChallenge = (auth = signedInAs(ADMIN), e: object = env) =>
  request("/admin/ingest/challenge", { method: "POST" }, e, auth);

const trigger = (body: unknown, auth = signedInAs(ADMIN), e: object = env) =>
  request(
    "/admin/ingest",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    e,
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

/**
 * 另一位管理員(不同使用者、不同信箱、不同 session)。重寄間隔以使用者計,
 * 需要「同一時刻另有一組有效碼」的冷卻情境用這個,而不是同一使用者的 otherSession()。
 */
function otherAdmin() {
  const auth = signedInAs(OTHER_ADMIN);
  return {
    user: { ...auth.user!, id: "other-user" },
    session: { ...auth.session!, id: "other-admin-session", token: "other-admin-token", userId: "other-user" },
  };
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

  it("60 秒內再要求 → 429 resend_too_soon + Retry-After,不寄信;60 秒後可再要求", async () => {
    await requestChallenge();

    vi.setSystemTime(new Date("2026-10-25T00:00:30.200Z"));
    const tooSoon = await requestChallenge();
    expect(tooSoon.status).toBe(429);
    // 剩 29.8 秒 → 無條件進位成 30
    expect(tooSoon.headers.get("Retry-After")).toBe("30");
    expect(await tooSoon.json()).toEqual({ error: "resend_too_soon", retryAfter: 30 });
    expect(inbox.messages).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-25T00:01:00Z"));
    expect((await requestChallenge()).status).toBe(202);
    expect(inbox.messages).toHaveLength(2);
  });

  it("重寄間隔以收件人(使用者)計:同帳號的別的 session 60 秒內要求也被擋", async () => {
    await requestChallenge();
    vi.setSystemTime(new Date("2026-10-25T00:00:10Z"));
    const res = await requestChallenge(otherSession());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "resend_too_soon", retryAfter: 50 });
    expect(inbox.messages).toHaveLength(1);
  });

  it.each([
    ["寄送失敗", { ok: false, error: { code: "UPSTREAM_ERROR", message: "provider down" } }],
    ["收件人被拒", { ok: false, deliveries: [{ recipient: ADMIN, ok: false, error: { code: "UNVERIFIED_DESTINATION", message: "x" } }] }],
  ] as const)("%s → 502 email_send_failed,不留下可用的碼,立刻重新要求不受重寄間隔限制", async (_, failure) => {
    vi.mocked(sendEmail).mockResolvedValueOnce(failure as Awaited<ReturnType<typeof sendEmail>>);
    const failed = await requestChallenge();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "email_send_failed" });

    // 寄信失敗沒有寫入 challenge:任何碼都是 challenge_invalid
    const res = await trigger({ code: "123456" });
    expect(await res.json()).toEqual({ error: "challenge_invalid" });

    const retry = await requestChallenge();
    expect(retry.status).toBe(202);
    expect(inbox.messages).toHaveLength(1);
  });

  it("重寄間隔可用 CHALLENGE_RESEND_SECONDS 覆寫", async () => {
    const quick = { ...env, CHALLENGE_RESEND_SECONDS: "10" };
    const first = await request("/admin/ingest/challenge", { method: "POST" }, quick, signedInAs(ADMIN));
    expect(await first.json()).toMatchObject({ resendAfter: "2026-10-25T00:00:10.000Z" });

    vi.setSystemTime(new Date("2026-10-25T00:00:10Z"));
    expect((await request("/admin/ingest/challenge", { method: "POST" }, quick, signedInAs(ADMIN))).status).toBe(202);
  });
});

describe("POST /admin/ingest — 帶驗證碼觸發", () => {
  beforeEach(() => {
    vi.mocked(runIngest).mockReset();
    vi.mocked(runIngest).mockResolvedValue(okRun);
  });

  it("正確碼 → 200 並執行抓取一次;同碼再用 → 冷卻中 429,冷卻後(碼未過期)422 challenge_invalid", async () => {
    const short = { ...env, CHALLENGE_COOLDOWN_SECONDS: "60" };
    await requestChallenge(signedInAs(ADMIN), short);
    const code = latestCode();

    const first = await trigger({ code }, signedInAs(ADMIN), short);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "ok", dataTime: "2026-10-22", dataCount: 1, fetched: 1, upserted: 1 });
    expect(runIngest).toHaveBeenCalledOnce();

    expect((await trigger({ code }, signedInAs(ADMIN), short)).status).toBe(429);

    vi.setSystemTime(new Date("2026-10-25T00:01:00Z"));
    const again = await trigger({ code }, signedInAs(ADMIN), short);
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

  it("重新要求後舊碼被拒(對目前有效的新碼而言就是錯碼 → code_mismatch),新碼可用", async () => {
    await requestChallenge();
    const oldCode = latestCode();
    vi.setSystemTime(new Date("2026-10-25T00:02:00Z"));
    await requestChallenge();
    const newCode = latestCode();
    // 極小機率兩次產生同一組碼;那樣舊碼就無從區分
    expect(newCode).not.toBe(oldCode);

    const old = await trigger({ code: oldCode });
    expect(old.status).toBe(422);
    expect(await old.json()).toEqual({ error: "code_mismatch", attemptsLeft: 4 });

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
  ])("body %s → 400 ValidationErrorResponse,不執行抓取,不消耗嘗試次數,碼仍可用", async (_, body) => {
    await requestChallenge();
    const res = await trigger(body);
    expect(res.status).toBe(400);
    expect(ValidationErrorResponse.parse(await res.json())).toEqual({
      error: "Validation failed",
      issues: [{ slot: "body", issues: [{ message: "code 須為 6 位數字", path: "code" }] }],
    });
    expect(runIngest).not.toHaveBeenCalled();

    // 400 之後第一次錯碼仍是 4 次機會
    expect(await (await trigger({ code: wrongCode(latestCode()) })).json()).toEqual({ error: "code_mismatch", attemptsLeft: 4 });
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

  it("碼不符 → 422 code_mismatch,attemptsLeft 逐次遞減,不執行抓取;還有機會時正確碼仍可用", async () => {
    await requestChallenge();
    const code = latestCode();

    for (const attemptsLeft of [4, 3]) {
      const res = await trigger({ code: wrongCode(code) });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "code_mismatch", attemptsLeft });
    }
    expect(runIngest).not.toHaveBeenCalled();

    expect((await trigger({ code })).status).toBe(200);
  });

  it("錯滿 5 次即作廢(第 5 次 attemptsLeft 0),之後正確碼也 → challenge_invalid", async () => {
    await requestChallenge();
    const code = latestCode();

    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      expect(await (await trigger({ code: wrongCode(code) })).json()).toEqual({ error: "code_mismatch", attemptsLeft });
    }

    const res = await trigger({ code });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "challenge_invalid" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("嘗試次數上限可用 CHALLENGE_MAX_ATTEMPTS 覆寫", async () => {
    const strict = { ...env, CHALLENGE_MAX_ATTEMPTS: "2" };
    await request("/admin/ingest/challenge", { method: "POST" }, strict, signedInAs(ADMIN));
    const code = latestCode();
    const send = (c: string) =>
      request(
        "/admin/ingest",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c }) },
        strict,
        signedInAs(ADMIN),
      );

    expect(await (await send(wrongCode(code))).json()).toEqual({ error: "code_mismatch", attemptsLeft: 1 });
    expect(await (await send(wrongCode(code))).json()).toEqual({ error: "code_mismatch", attemptsLeft: 0 });
    expect(await (await send(code)).json()).toEqual({ error: "challenge_invalid" });
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

describe("觸發冷卻:手動觸發開始後 10 分鐘內不能要求驗證碼、不能觸發", () => {
  beforeEach(() => {
    vi.mocked(runIngest).mockReset();
    vi.mocked(runIngest).mockResolvedValue(okRun);
  });

  /** 00:00 要求驗證碼並觸發成功,冷卻到 00:10。 */
  async function triggerOnce() {
    await requestChallenge();
    expect((await trigger({ code: latestCode() })).status).toBe(200);
    inbox.clear();
  }

  it("冷卻中要求驗證碼 → 429 { error: cooldown, retryAfter } 帶 Retry-After,不寄信", async () => {
    await triggerOnce();

    vi.setSystemTime(new Date("2026-10-25T00:03:00Z"));
    const res = await requestChallenge();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("420");
    expect(await res.json()).toEqual({ error: "cooldown", retryAfter: 420 });
    expect(inbox.messages).toHaveLength(0);
  });

  it("冷卻開始前就要的有效碼,冷卻中使用 → 429 cooldown,不抓取、碼不被消耗", async () => {
    // 另一位管理員先要一組碼(10 分鐘有效),本 session 接著觸發 → 冷卻開始
    await requestChallenge(otherAdmin());
    const early = latestCode();
    await triggerOnce();

    vi.setSystemTime(new Date("2026-10-25T00:09:59.500Z"));
    const res = await trigger({ code: early }, otherAdmin());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
    expect(await res.json()).toEqual({ error: "cooldown", retryAfter: 1 });
    expect(runIngest).toHaveBeenCalledOnce();
  });

  it("被冷卻擋下的碼沒有被消耗:冷卻結束後(CHALLENGE_COOLDOWN_SECONDS 覆寫為 120)仍可觸發", async () => {
    const short = { ...env, CHALLENGE_COOLDOWN_SECONDS: "120" };
    await requestChallenge(otherAdmin(), short);
    const early = latestCode();
    await requestChallenge(signedInAs(ADMIN), short);
    expect((await trigger({ code: latestCode() }, signedInAs(ADMIN), short)).status).toBe(200);

    vi.setSystemTime(new Date("2026-10-25T00:01:00Z"));
    const blocked = await trigger({ code: early }, otherAdmin(), short);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "cooldown", retryAfter: 60 });

    vi.setSystemTime(new Date("2026-10-25T00:02:00Z"));
    expect((await trigger({ code: early }, otherAdmin(), short)).status).toBe(200);
    expect(runIngest).toHaveBeenCalledTimes(2);
  });

  it("10 分鐘後恢復:可要求驗證碼、可觸發;到期前一刻仍在冷卻", async () => {
    await triggerOnce();

    vi.setSystemTime(new Date("2026-10-25T00:09:59.999Z"));
    const last = await requestChallenge();
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "cooldown", retryAfter: 1 });

    vi.setSystemTime(new Date("2026-10-25T00:10:00Z"));
    expect((await requestChallenge()).status).toBe(202);
    expect(inbox.messages).toHaveLength(1);
    expect((await trigger({ code: latestCode() })).status).toBe(200);
    expect(runIngest).toHaveBeenCalledTimes(2);
  });

  it("抓取失敗(500)也算進冷卻", async () => {
    vi.mocked(runIngest).mockRejectedValueOnce(new Error("Anue HTTP 500"));
    await requestChallenge();
    expect((await trigger({ code: latestCode() })).status).toBe(500);

    vi.setSystemTime(new Date("2026-10-25T00:00:30Z"));
    const res = await requestChallenge();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "cooldown", retryAfter: 570 });
  });

  it("冷卻是全域的:別的 session 也被擋", async () => {
    await triggerOnce();
    const res = await requestChallenge(otherSession());
    expect(res.status).toBe(429);
    expect(inbox.messages).toHaveLength(0);
  });

  describe("cron 不受冷卻限制,也不算進冷卻", () => {
    /** 跑一次 cron,等 waitUntil 掛起的工作結束。 */
    async function runCron() {
      vi.spyOn(console, "log").mockImplementationOnce(() => {});
      let pending: Promise<unknown> = Promise.resolve();
      scheduled({} as ScheduledController, env as never, { waitUntil: (p: Promise<unknown>) => (pending = p) } as never);
      await pending;
    }

    it("冷卻中 cron 照常執行抓取", async () => {
      await triggerOnce();
      await runCron();
      expect(runIngest).toHaveBeenCalledTimes(2);
    });

    it("cron 剛跑完,手動要求驗證碼、觸發不被擋", async () => {
      await runCron();
      expect((await requestChallenge()).status).toBe(202);
      expect((await trigger({ code: latestCode() })).status).toBe(200);
    });

    it("冷卻中跑 cron 不會延長冷卻:仍以手動觸發起算", async () => {
      await triggerOnce();
      vi.setSystemTime(new Date("2026-10-25T00:05:00Z"));
      await runCron();
      vi.setSystemTime(new Date("2026-10-25T00:10:00Z"));
      expect((await requestChallenge()).status).toBe(202);
    });
  });

  it("兩個 session 同時帶各自的有效碼觸發 → 恰好一個 200、另一個 429 cooldown 且碼不被消耗", async () => {
    const short = { ...env, CHALLENGE_COOLDOWN_SECONDS: "60" };
    await requestChallenge(otherAdmin(), short);
    const otherCode = latestCode();
    await requestChallenge(signedInAs(ADMIN), short);
    const ownCode = latestCode();

    const results = await Promise.all([
      trigger({ code: ownCode }, signedInAs(ADMIN), short),
      trigger({ code: otherCode }, otherAdmin(), short),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    const loser = results.find((r) => r.status === 429)!;
    expect(await loser.json()).toEqual({ error: "cooldown", retryAfter: 60 });
    expect(runIngest).toHaveBeenCalledOnce();

    // 輸的那組碼沒被消耗:冷卻結束後仍可用
    vi.setSystemTime(new Date("2026-10-25T00:01:00Z"));
    const retry =
      results[0].status === 429
        ? await trigger({ code: ownCode }, signedInAs(ADMIN), short)
        : await trigger({ code: otherCode }, otherAdmin(), short);
    expect(retry.status).toBe(200);
  });

  it("冷卻中帶錯碼 → 429 cooldown(冷卻先於驗證碼檢查)", async () => {
    await requestChallenge(otherAdmin());
    const early = latestCode();
    await triggerOnce();

    const res = await trigger({ code: wrongCode(early) }, otherAdmin());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "cooldown", retryAfter: 600 });
  });
});
