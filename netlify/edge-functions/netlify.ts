/**
 * OHTTP Relay — Netlify edge function
 */

import { configFromEnv, createApp } from "../../src/relay.ts";

export default createApp(configFromEnv((k) => Deno.env.get(k))).fetch;
