import { app } from "./app";
import { scheduled } from "./triggers/scheduled";

export default {
  fetch: app.fetch,
  scheduled,
};
