/// <reference types="@cloudflare/workers-types" />
/**
 * OHTTP Relay — Cloudflare Workers entry point
 *
 * Wraps the platform-agnostic relay with Cloudflare-specific bindings:
 * - Optional service binding to a co-located ohttp-gateway Worker
 * - Typed environment variable bindings via wrangler
 */

import { handleRequest } from "./relay";

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
	async fetch(request: Request, env: Env): Promise<Response> {
		return handleRequest(request, {
			gatewayUrl: env.GATEWAY_URL,
			maxRequestSize: parseInt(env.MAX_REQUEST_SIZE, 10),
			corsOrigin: env.CORS_ORIGIN,
			...(env.USE_SERVICE_BINDING === "true" && { fetcher: env.GATEWAY.fetch.bind(env.GATEWAY) }),
		});
	},
};
