/**
 * OHTTP Relay — platform-neutral relay decisions
 *
 * Strings in, verdicts out. Nothing here touches `Request`, `Response` or
 * `IncomingMessage`, which is what lets the Node server (node:http throughout)
 * and the edge handler (Fetch API throughout) share it without either one
 * paying for the other's abstractions.
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
	 * Defaults to the global fetch. Ignored by the Node server, which forwards
	 * over node:http directly.
	 */
	fetcher?: typeof fetch;
}

const defaults = {
	maxRequestSize: 1_048_576,
	corsOrigin: "*",
} as const;

/**
 * Build a RelayConfig from an environment variable getter.
 * Use for Node.js/Vercel (`(k) => process.env[k]`) and Netlify (`(k) => Deno.env.get(k)`).
 *
 * `GATEWAY_URL` is required: without it the relay would silently forward
 * traffic to an unintended host, so we fail closed instead of defaulting.
 */
export function configFromEnv(
	get: (key: string) => string | undefined,
): RelayConfig {
	const gatewayUrl = get("GATEWAY_URL");
	if (gatewayUrl === undefined || gatewayUrl === "") {
		throw new Error(
			"GATEWAY_URL is required: set it to your OHTTP gateway URL (e.g. https://gateway.ohttp.info/ohttp)",
		);
	}
	return {
		gatewayUrl,
		maxRequestSize: parseSize(get("MAX_REQUEST_SIZE")),
		corsOrigin: get("CORS_ORIGIN") ?? defaults.corsOrigin,
	};
}

/**
 * A malformed limit falls back to the default rather than becoming NaN: every
 * comparison against NaN is false, so the size checks would have failed open.
 */
export function parseSize(raw: string | undefined): number {
	const size = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(size) && size > 0 ? size : defaults.maxRequestSize;
}

/** Content types the relay is willing to forward on POST. */
const validContentTypes: readonly string[] = [
	MediaType.REQUEST,
	MediaType.CHUNKED_REQUEST,
];

/**
 * Lowercase names on purpose: node:http lowercases the headers it receives, so
 * Title-Case keys here would not overwrite a gateway's own CORS headers and
 * both would be sent.
 */
export function corsHeaders(origin: string): Record<string, string> {
	return {
		"access-control-allow-origin": origin,
		// A single configured origin still varies the response by Origin as far
		// as any cache in front of the relay is concerned.
		...(origin !== "*" && { vary: "Origin" }),
		"access-control-allow-methods": "GET,POST,OPTIONS",
		"access-control-allow-headers":
			"Content-Type,signature,signature-agent,signature-input",
		"access-control-max-age": "86400",
	};
}

/** `null` accepts the request; otherwise the status and message to reject with. */
export function rejectPost(
	contentType: string | undefined,
	contentLength: string | undefined,
	maxRequestSize: number,
): { status: number; error: string } | null {
	if (contentType === undefined || !validContentTypes.includes(contentType)) {
		return { status: 415, error: `Expected ${validContentTypes.join(" or ")}` };
	}
	if (
		contentLength !== undefined &&
		Number.parseInt(contentLength, 10) > maxRequestSize
	) {
		return {
			status: 413,
			error: `Request exceeds ${maxRequestSize} byte limit`,
		};
	}
	return null;
}

/**
 * The only headers that travel to the gateway: Content-Type and Incremental.
 *
 * Everything identifying the client is dropped — the gateway must see the
 * relay's identity, never the client's. Returning a plain object rather than
 * `Headers` keeps this usable from node:http, and means the Node path sends
 * exactly these keys and nothing else.
 */
export function forwardHeaders(
	contentType: string | undefined,
	// A repeated header arrives joined with ", " — node:http only hands back an
	// array for set-cookie — which parses to undefined and is dropped.
	incrementalRaw: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {};
	if (contentType !== undefined) headers["Content-Type"] = contentType;
	if (incrementalRaw !== undefined) {
		const incremental = Incremental.parse(incrementalRaw);
		if (incremental !== undefined) {
			headers[Incremental.HEADER] = Incremental.serialize(incremental);
		}
	}
	return headers;
}

/**
 * Per-connection headers, which describe the gateway leg and mean nothing on
 * the client leg. Forwarding `Connection: close` ends the client's keep-alive
 * to the relay; `Set-Cookie` lets the gateway mark a client the relay exists to
 * keep unlinkable. Both paths need this: node:http hands them over verbatim,
 * and undici does not drop them either — `new Headers(response.headers)` keeps
 * `set-cookie` (and `getSetCookie()` returns it), so a gateway can otherwise
 * mark a client straight through the relay.
 */
const hopByHop: readonly string[] = [
	"connection",
	"keep-alive",
	"transfer-encoding",
	"te",
	"trailer",
	"upgrade",
	"set-cookie",
];

/** Copy of `headers` without the per-connection ones. Keys arrive lowercased. */
export function stripHopByHop<T>(
	headers: Record<string, T>,
): Record<string, T> {
	const out: Record<string, T> = {};
	for (const [name, value] of Object.entries(headers)) {
		const key = name.toLowerCase();
		if (hopByHop.includes(key) || key.startsWith("proxy-")) continue;
		out[key] = value;
	}
	return out;
}
