import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

/** 由 D1 binding 建立帶 schema 的 drizzle 實例。 */
export const makeDb = (d1: D1Database) => drizzle(d1, { schema });

export type DB = ReturnType<typeof makeDb>;
