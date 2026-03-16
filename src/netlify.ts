/**
 * OHTTP Relay — Netlify Hono app
 */

import { configFromEnv, createApp } from "./relay.js";

export default createApp(configFromEnv((k) => Deno.env.get(k)));
