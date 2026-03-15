/**
 * OHTTP Relay — Netlify Edge Function entry point
 *
 * Handles all relay routes (configured via netlify.toml).
 * Runs on Netlify's Edge Functions runtime (Deno).
 */

import { handleRequest } from "../../src/relay.ts";

export default async function (request: Request): Promise<Response> {
	return handleRequest(request, {
		gatewayUrl: Deno.env.get("GATEWAY_URL") ?? "https://gateway.ohttp.info",
		maxRequestSize: parseInt(Deno.env.get("MAX_REQUEST_SIZE") ?? "1048576", 10),
		corsOrigin: Deno.env.get("CORS_ORIGIN") ?? "*",
	});
}

export const config = { path: "/*" };
