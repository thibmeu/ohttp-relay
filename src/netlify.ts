/**
 * OHTTP Relay — Netlify Edge Function entry point
 */

import { handle } from "hono/netlify";
import { configFromEnv, createApp } from "./relay";

export default handle(createApp(configFromEnv((k) => Deno.env.get(k))));

export const config = { path: "/*" };
