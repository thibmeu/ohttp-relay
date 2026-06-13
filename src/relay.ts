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

export const defaults = {
	gatewayUrl: "https://gateway.ohttp.info/ohttp",
	maxRequestSize: 1_048_576,
	corsOrigin: "*",
} as const;

/**
 * Build a RelayConfig from an environment variable getter.
 * Use for Node.js/Vercel (`(k) => process.env[k]`) and Netlify (`(k) => Deno.env.get(k)`).
 */
export function configFromEnv(
	get: (key: string) => string | undefined,
): RelayConfig {
	return {
		gatewayUrl: get("GATEWAY_URL") ?? defaults.gatewayUrl,
		maxRequestSize: Number.parseInt(
			get("MAX_REQUEST_SIZE") ?? String(defaults.maxRequestSize),
			10,
		),
		corsOrigin: get("CORS_ORIGIN") ?? defaults.corsOrigin,
	};
}

const validContentTypes: readonly string[] = [
	MediaType.REQUEST,
	MediaType.CHUNKED_REQUEST,
];

export function createApp(config: RelayConfig): Hono {
	const app = new Hono();
	const fetcher = config.fetcher ?? fetch;

	app.use(
		"*",
		cors({
			origin: config.corsOrigin,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"signature",
				"signature-agent",
				"signature-input",
			],
			maxAge: 86400,
		}),
	);

	app.get("/health", (c) => c.text("OK"));

	app.all("/*", async (c) => {
		const { method } = c.req;
		const contentType = c.req.header("Content-Type");

		// Validate Content-Type on POST requests
		if (method === "POST") {
			if (
				contentType === undefined ||
				!validContentTypes.includes(contentType)
			) {
				return c.json(
					{ error: `Expected ${validContentTypes.join(" or ")}` },
					415,
				);
			}

			const contentLength = c.req.header("Content-Length");
			if (
				contentLength !== undefined &&
				Number.parseInt(contentLength, 10) > config.maxRequestSize
			) {
				return c.json(
					{ error: `Request exceeds ${config.maxRequestSize} byte limit` },
					413,
				);
			}
		}

		// Build forwarded headers.
		// Strip all identifying headers — only forward Content-Type and Incremental.
		// The gateway must only see the relay's identity, not the client's.
		const headers = new Headers();
		if (contentType !== undefined) headers.set("Content-Type", contentType);
		const incremental = Incremental.get(c.req.raw.headers);
		if (incremental !== undefined) Incremental.set(headers, incremental);

		const hasBody = method !== "GET" && method !== "HEAD";
		const upstream = await fetcher(config.gatewayUrl, {
			method,
			headers,
			...(hasBody && { body: c.req.raw.body, duplex: "half" }),
		} as RequestInit);
		// Wrap in a new Response so CORS middleware can mutate headers
		// (fetch Response headers are immutable in Node.js)
		return new Response(upstream.body, upstream);
	});

	return app;
}
