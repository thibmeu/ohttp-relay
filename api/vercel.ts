import { handle } from "hono/vercel";
import { configFromEnv, createApp } from "../src/relay";

export const config = { runtime: "edge" };
export default handle(createApp(configFromEnv((k) => process.env[k])));
