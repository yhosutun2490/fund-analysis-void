// GET / 的回應契約。
import { z } from "zod";
import { disclaimer } from "./shared";

export const RootResponse = z.strictObject({
  name: z.string(),
  kind: z.string(),
  endpoints: z.array(z.string()),
  disclaimer,
});
