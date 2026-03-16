import { handle } from "hono/vercel";
import app from "../src/vercel.js";

export const config = { runtime: "edge" };
export default handle(app);
