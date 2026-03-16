/**
 * OHTTP Relay — Netlify Hono app
 */

import { configFromEnv, createApp } from "./relay.ts";

export default createApp(configFromEnv((k) => Deno.env.get(k)));
