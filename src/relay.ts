/**
 * OHTTP Relay — platform-agnostic core
 *
 * Implements RFC 9458 relay forwarding: passes encrypted OHTTP requests
 * to a gateway without decrypting them.
 *
 * Used by all platform adapters (Cloudflare Workers, Vercel, Netlify, Railway).
 *
 * Endpoints:
 * - POST /ohttp         → Forward to gateway (message/ohttp-req)
 * - POST /chunked-ohttp → Chunked forward (message/ohttp-chunked-req)
 * - GET  /ohttp-config  → Proxy gateway key configuration
 * - GET  /health        → Health check
 */

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
	fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function getCORSHeaders(config: RelayConfig): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": config.corsOrigin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, signature, signature-agent, signature-input",
		"Access-Control-Max-Age": "86400",
	};
}

function withCORS(response: Response, config: RelayConfig): Response {
	const corsResponse = new Response(response.body, response);
	for (const [key, value] of Object.entries(getCORSHeaders(config))) {
		corsResponse.headers.set(key, value);
	}
	return corsResponse;
}

function errorResponse(status: number, message: string, config: RelayConfig): Response {
	return withCORS(
		new Response(JSON.stringify({ error: message }), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
		config,
	);
}

export async function handleRequest(request: Request, config: RelayConfig): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: getCORSHeaders(config) });
	}

	switch (url.pathname) {
		case "/ohttp":
			return handleOHTTP(request, config);
		case "/ohttp-config":
			return handleKeyConfig(request, config);
		case "/chunked-ohttp":
			return handleChunkedOHTTP(request, config);
		case "/health":
			return new Response("OK", { status: 200 });
		default:
			return errorResponse(404, "Not found", config);
	}
}

/**
 * GET /ohttp-config
 *
 * Proxies key configuration from the gateway.
 * Compatibility alias used by some OHTTP clients (e.g. ferret).
 */
async function handleKeyConfig(request: Request, config: RelayConfig): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return errorResponse(405, "Method not allowed", config);
	}

	try {
		const fetcher = config.fetcher ?? fetch;
		const response = await fetcher(`${config.gatewayUrl}/ohttp-config`, { method: request.method });
		return withCORS(response, config);
	} catch (error) {
		console.error("Key config fetch error:", error);
		return errorResponse(502, "Gateway unavailable", config);
	}
}

/**
 * POST /ohttp
 *
 * Forwards an encapsulated OHTTP request to the gateway.
 * Relay MUST NOT decrypt — pure passthrough.
 */
async function handleOHTTP(request: Request, config: RelayConfig): Promise<Response> {
	if (request.method !== "POST") {
		return errorResponse(405, "Method not allowed", config);
	}

	const contentType = request.headers.get("Content-Type");
	if (contentType !== null && contentType !== MediaType.REQUEST) {
		return errorResponse(415, `Expected ${MediaType.REQUEST}`, config);
	}

	const contentLength = request.headers.get("Content-Length");
	if (contentLength !== null && parseInt(contentLength, 10) > config.maxRequestSize) {
		return errorResponse(413, `Request exceeds ${config.maxRequestSize} byte limit`, config);
	}

	try {
		return withCORS(await forwardToGateway(request, config, "/ohttp"), config);
	} catch (error) {
		console.error("Relay error:", error);
		return errorResponse(502, "Gateway unavailable", config);
	}
}

/**
 * POST /chunked-ohttp
 *
 * Forwards a chunked (streaming) OHTTP request to the gateway.
 * Relay MUST NOT decrypt — pure streaming passthrough.
 */
async function handleChunkedOHTTP(request: Request, config: RelayConfig): Promise<Response> {
	if (request.method !== "POST") {
		return errorResponse(405, "Method not allowed", config);
	}

	const contentType = request.headers.get("Content-Type");
	if (contentType !== MediaType.CHUNKED_REQUEST) {
		return errorResponse(415, `Expected ${MediaType.CHUNKED_REQUEST}`, config);
	}

	try {
		return withCORS(
			await forwardToGateway(request, config, "/chunked-ohttp", MediaType.CHUNKED_REQUEST),
			config,
		);
	} catch (error) {
		console.error("Relay chunked error:", error);
		return errorResponse(502, "Gateway unavailable", config);
	}
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

	const url = `${config.gatewayUrl}${path}`;
	const fetcher = config.fetcher ?? fetch;
	return fetcher(url, { method: "POST", headers, body: request.body });
}
