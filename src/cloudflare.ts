/// <reference types="@cloudflare/workers-types" />
/**
 * OHTTP Relay — Cloudflare Workers entry point
 *
 * Adds Cloudflare-specific bindings on top of the platform-agnostic relay:
 * - Optional service binding to a co-located ohttp-gateway Worker
 * - Typed environment variable bindings via wrangler
 */

import { createApp } from "./relay";

interface Env {
	/** Service binding to an ohttp-gateway Worker (optional, requires wrangler.toml [[services]]) */
	GATEWAY: Fetcher;
	/** Set to "true" to forward via GATEWAY service binding instead of GATEWAY_URL */
	USE_SERVICE_BINDING: string;
	/** Gateway base URL used when USE_SERVICE_BINDING is "false" */
	GATEWAY_URL: string;
	/** Maximum request body size in bytes */
	MAX_REQUEST_SIZE: string;
	/** CORS allowed origin */
	CORS_ORIGIN: string;
}

export default {
	fetch(request: Request, env: Env) {
		return createApp({
			gatewayUrl: env.GATEWAY_URL,
			maxRequestSize: parseInt(env.MAX_REQUEST_SIZE, 10),
			corsOrigin: env.CORS_ORIGIN,
			...(env.USE_SERVICE_BINDING === "true" && { fetcher: env.GATEWAY.fetch.bind(env.GATEWAY) }),
		}).fetch(request);
	},
};
