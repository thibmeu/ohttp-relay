/// <reference types="node" />
/**
 * OHTTP Relay — Vercel Hono app
 */

import { configFromEnv, createApp } from "./relay.js";

export default createApp(configFromEnv((k) => process.env[k]));
