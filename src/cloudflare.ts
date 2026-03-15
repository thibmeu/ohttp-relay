/// <reference types="@cloudflare/workers-types" />
/**
 * OHTTP Relay — Cloudflare Workers entry point
 *
 * Adds Cloudflare-specific bindings on top of the platform-agnostic relay:
 * - Optional service binding to a co-located ohttp-gateway Worker
 * - Typed environment variable bindings via wrangler
 */

import { type Hono } from "hono";
import { createApp } from "./relay";

interface Env {
	/** Service binding to an ohttp-gateway Worker (optional, requires wrangler.toml [[services]]) */
	GATEWAY?: Fetcher;
	/** Gateway base URL used when GATEWAY service binding is not set */
	GATEWAY_URL: string;
	/** Maximum request body size in bytes */
	MAX_REQUEST_SIZE: string;
	/** CORS allowed origin */
	CORS_ORIGIN: string;
}

let app: Hono | undefined;

export default {
	fetch(request: Request, env: Env) {
		app ??= createApp({
			gatewayUrl: env.GATEWAY_URL,
			maxRequestSize: parseInt(env.MAX_REQUEST_SIZE, 10),
			corsOrigin: env.CORS_ORIGIN,
			...(env.GATEWAY && { fetcher: env.GATEWAY.fetch.bind(env.GATEWAY) }),
		});
		return app.fetch(request);
	},
};
