/**
 * OHTTP Relay — Vercel Edge Function entry point
 *
 * Handles all relay routes routed here via vercel.json rewrites.
 * Runs on Vercel's Edge Runtime (WinterCG-compatible V8 isolates).
 */

import { handleRequest } from "../src/relay";

export const config = {
	runtime: "edge",
};

export default async function handler(request: Request): Promise<Response> {
	return handleRequest(request, {
		gatewayUrl: process.env.GATEWAY_URL ?? "https://gateway.ohttp.info",
		maxRequestSize: parseInt(process.env.MAX_REQUEST_SIZE ?? "1048576", 10),
		corsOrigin: process.env.CORS_ORIGIN ?? "*",
	});
}
