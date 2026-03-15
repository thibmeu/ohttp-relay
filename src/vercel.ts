/**
 * OHTTP Relay — Vercel Edge Function entry point
 */

import { handle } from "hono/vercel";
import { configFromEnv, createApp } from "./relay";

export const config = { runtime: "edge" };

export default handle(createApp(configFromEnv((k) => process.env[k])));
