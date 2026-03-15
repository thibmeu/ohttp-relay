/**
 * OHTTP Relay — platform-agnostic Hono app
 *
 * Implements RFC 9458 relay forwarding: passes encrypted OHTTP requests
 * to a gateway without decrypting them.
 *
 * Call createApp(config) to get a Hono app ready for any platform.
 *
 * Endpoints:
 * - POST /ohttp         → Forward to gateway (message/ohttp-req)
 * - POST /chunked-ohttp → Chunked forward (message/ohttp-chunked-req)
 * - GET  /ohttp-config  → Proxy gateway key configuration
 * - GET  /health        → Health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { Incremental, MediaType } from "ohttp-ts";

export interface RelayConfig {
	/** Gateway base URL (e.g. https://gateway.ohttp.info) */
	gatewayUrl: string;
	/** Maximum request body size in bytes */
	maxRequestSize: number;
	/** CORS allowed origin */
	corsOrigin: string;
	/**
	 * Optional custom fetch implementation.
	 * Pass a Cloudflare service binding here for zero-latency gateway calls.
	 * Defaults to the global fetch.
	 */
	fetcher?: typeof fetch;
}

export function createApp(config: RelayConfig): Hono {
	const app = new Hono();

	app.use(
		"*",
		cors({
			origin: config.corsOrigin,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "signature", "signature-agent", "signature-input"],
			maxAge: 86400,
		}),
	);

	app.get("/health", (c) => c.text("OK"));

	/**
	 * GET /ohttp-config
	 * Proxies key configuration from the gateway.
	 * Compatibility alias used by some OHTTP clients (e.g. ferret).
	 */
	app.get("/ohttp-config", async (c) => {
		try {
			const fetcher = config.fetcher ?? fetch;
			const resp = await fetcher(`${config.gatewayUrl}/ohttp-config`);
			return new Response(resp.body, resp);
		} catch (err) {
			console.error("Key config fetch error:", err);
			return c.json({ error: "Gateway unavailable" }, 502);
		}
	});

	/**
	 * POST /ohttp
	 * Forwards an encapsulated OHTTP request to the gateway.
	 * Relay MUST NOT decrypt — pure passthrough.
	 */
	app.post("/ohttp", async (c) => {
		const contentType = c.req.header("Content-Type");
		if (contentType !== undefined && contentType !== MediaType.REQUEST) {
			return c.json({ error: `Expected ${MediaType.REQUEST}` }, 415);
		}

		const contentLength = c.req.header("Content-Length");
		if (contentLength !== undefined && parseInt(contentLength, 10) > config.maxRequestSize) {
			return c.json({ error: `Request exceeds ${config.maxRequestSize} byte limit` }, 413);
		}

		try {
			return forwardToGateway(c.req.raw, config, "/ohttp");
		} catch (err) {
			console.error("Relay error:", err);
			return c.json({ error: "Gateway unavailable" }, 502);
		}
	});

	/**
	 * POST /chunked-ohttp
	 * Forwards a chunked (streaming) OHTTP request to the gateway.
	 * Relay MUST NOT decrypt — pure streaming passthrough.
	 */
	app.post("/chunked-ohttp", async (c) => {
		const contentType = c.req.header("Content-Type");
		if (contentType !== MediaType.CHUNKED_REQUEST) {
			return c.json({ error: `Expected ${MediaType.CHUNKED_REQUEST}` }, 415);
		}

		try {
			return forwardToGateway(c.req.raw, config, "/chunked-ohttp", MediaType.CHUNKED_REQUEST);
		} catch (err) {
			console.error("Relay chunked error:", err);
			return c.json({ error: "Gateway unavailable" }, 502);
		}
	});

	return app;
}

/**
 * Forward a request to the gateway.
 *
 * NOTE: Only Content-Type and Incremental headers are forwarded.
 * Client-identifying headers (IP, User-Agent, etc.) MUST NOT be forwarded —
 * the gateway must only see the relay's identity, not the client's.
 */
async function forwardToGateway(
	request: Request,
	config: RelayConfig,
	path: string,
	contentType: string = MediaType.REQUEST,
): Promise<Response> {
	const headers = new Headers({ "Content-Type": contentType });
	const incremental = Incremental.get(request.headers);
	if (incremental !== undefined) {
		Incremental.set(headers, incremental);
	}

	const fetcher = config.fetcher ?? fetch;
	return fetcher(`${config.gatewayUrl}${path}`, {
		method: "POST",
		headers,
		body: request.body,
	});
}
