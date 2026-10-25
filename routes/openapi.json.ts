// GET /openapi.json:OpenAPI 3.1 文件,由端點契約登錄表產生。登錄表是靜態的,模組載入時產生一次。
import { defineHandler } from "void";
import { toOpenAPI } from "../src/lib/openapi";
import { endpoints } from "../src/schemas/endpoints";

const doc = toOpenAPI(endpoints);

export const GET = defineHandler((c) => c.json(doc));
