import { Hono } from "hono";
import type { Env } from "../bindings";
import { listCategories } from "../repositories/funds";
import { listRuns } from "../repositories/ingest";
import { CategoriesResponse, RunsResponse } from "../responses";
import { responds } from "../validation";

export const meta = new Hono<{ Bindings: Env }>();

meta.get("/categories", responds({ 200: CategoriesResponse }), async (c) => c.json({ categories: await listCategories(c.env.DB) }));

meta.get("/runs", responds({ 200: RunsResponse }), async (c) => c.json({ runs: await listRuns(c.env.DB) }));
