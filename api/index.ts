/**
 * OHTTP Relay — Vercel Edge Function entry point
 */

import { handle } from "hono/vercel";
import { createApp } from "../src/relay";

export const config = { runtime: "edge" };

export default handle(
	createApp({
		gatewayUrl: process.env.GATEWAY_URL ?? "https://gateway.ohttp.info",
		maxRequestSize: parseInt(process.env.MAX_REQUEST_SIZE ?? "1048576", 10),
		corsOrigin: process.env.CORS_ORIGIN ?? "*",
	}),
);
