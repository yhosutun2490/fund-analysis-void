import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/ingest", () => ({
  runIngest: vi.fn().mockResolvedValue({ status: "ok" }),
}));

import { scheduled } from "../src/triggers/scheduled";
import { runIngest } from "../src/services/ingest";

const callScheduled = (ctx: ExecutionContext) =>
  scheduled({} as ScheduledController, {} as never, ctx);

describe("scheduled trigger", () => {
  it("把工作交給 runIngest 並透過 waitUntil 掛起", () => {
    const promises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => promises.push(p),
    } as unknown as ExecutionContext;

    callScheduled(ctx);

    expect(runIngest).toHaveBeenCalledOnce();
    expect(promises).toHaveLength(1);
  });

  it("不向外丟出例外", () => {
    const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
    expect(() => callScheduled(ctx)).not.toThrow();
  });
});
