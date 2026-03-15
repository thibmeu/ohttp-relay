/**
 * OHTTP Relay — platform-agnostic Hono app
 *
 * Implements RFC 9458 relay forwarding: passes all requests through to the
 * gateway without decrypting them. The relay only validates Content-Type on
 * POST requests and strips identifying headers.
 *
 * Endpoints:
 * - GET  /health → Health check (relay-local, not forwarded)
 * - *    /*      → Forwarded to gateway, preserving path
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

	app.all("/*", async (c) => {
		const { method } = c.req;

		// Validate Content-Type on POST requests
		if (method === "POST") {
			const contentType = c.req.header("Content-Type");
			const validTypes: string[] = [MediaType.REQUEST, MediaType.CHUNKED_REQUEST];
			if (contentType === undefined || !validTypes.includes(contentType)) {
				return c.json({ error: `Expected ${validTypes.join(" or ")}` }, 415);
			}

			const contentLength = c.req.header("Content-Length");
			if (contentLength !== undefined && parseInt(contentLength, 10) > config.maxRequestSize) {
				return c.json({ error: `Request exceeds ${config.maxRequestSize} byte limit` }, 413);
			}
		}

		// Build forwarded headers.
		// Strip all identifying headers — only forward Content-Type and Incremental.
		// The gateway must only see the relay's identity, not the client's.
		const headers = new Headers();
		const contentType = c.req.header("Content-Type");
		if (contentType !== undefined) headers.set("Content-Type", contentType);
		const incremental = Incremental.get(c.req.raw.headers);
		if (incremental !== undefined) Incremental.set(headers, incremental);

		const path = new URL(c.req.url).pathname;
		const fetcher = config.fetcher ?? fetch;
		const hasBody = method !== "GET" && method !== "HEAD";
		return fetcher(`${config.gatewayUrl}${path}`, {
			method,
			headers,
			...(hasBody && { body: c.req.raw.body }),
		});
	});

	return app;
}
