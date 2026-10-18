import { defineScheduled } from "void";
import { scheduled } from "../src/triggers/scheduled";

// 每天台灣時間早上 7:00 抓一次（UTC 23:00）。風險指標月更、淨值日更，一天一次足夠。
export const cron = "0 23 * * *";

export default defineScheduled((controller, env, ctx) => scheduled(controller, env, ctx));
