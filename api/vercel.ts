/// <reference types="node" />
/**
 * OHTTP Relay — Vercel edge function
 *
 * `createApp().fetch` is already the edge signature, so there is nothing to
 * wrap it in: hono/vercel's handle() was exactly this.
 */

import { configFromEnv, createApp } from "../src/relay.ts";

export const config = { runtime: "edge" };

export default createApp(configFromEnv((k) => process.env[k])).fetch;
