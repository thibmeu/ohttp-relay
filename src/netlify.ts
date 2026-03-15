/**
 * OHTTP Relay — Netlify Edge Function entry point
 */

import { handle } from "hono/netlify";
import { createApp } from "./relay.ts";

export default handle(
	createApp({
		gatewayUrl: Deno.env.get("GATEWAY_URL") ?? "https://gateway.ohttp.info",
		maxRequestSize: parseInt(Deno.env.get("MAX_REQUEST_SIZE") ?? "1048576", 10),
		corsOrigin: Deno.env.get("CORS_ORIGIN") ?? "*",
	}),
);

export const config = { path: "/*" };
