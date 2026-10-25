// GET /api/meta/categories:各類別/類型的基金數。
import { defineHandler } from "void";
import { listCategories } from "../../../src/repositories/funds";
import { CategoriesResponse } from "../../../src/schemas/meta";
import { responds } from "../../../src/lib/validation";

export const GET = responds(
  { 200: CategoriesResponse },
  defineHandler(async (c) => c.json({ categories: await listCategories(c.env.DB) })),
);
