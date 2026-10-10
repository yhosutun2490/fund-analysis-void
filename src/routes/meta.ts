import { Hono } from "hono";
import type { Env } from "../env";
import { listCategories } from "../repositories/funds";
import { listRuns } from "../repositories/ingest";

export const meta = new Hono<{ Bindings: Env }>();

meta.get("/categories", async (c) => c.json({ categories: await listCategories(c.env.DB) }));

meta.get("/runs", async (c) => c.json({ runs: await listRuns(c.env.DB) }));
