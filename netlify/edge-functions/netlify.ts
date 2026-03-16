import { handle } from "hono/netlify";
import app from "../../src/netlify.ts";

export default handle(app);
