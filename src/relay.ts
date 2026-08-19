/**
 * OHTTP Relay — platform-agnostic Fetch API handler
 *
 * Passes requests through to the gateway without decrypting them (RFC 9458),
 * validating Content-Type on POST and stripping identifying headers.
 *
 * Used by every platform whose runtime speaks the Fetch API. Node does not come
 * through here — server.ts drives node:http end to end instead.
 *
 * - GET /health → answered locally, never forwarded
 * - everything else → forwarded to the gateway
 */

import {
	corsHeaders,
	forwardHeaders,
	type RelayConfig,
	rejectPost,
	stripHopByHop,
} from "./core.ts";

export { configFromEnv, type RelayConfig } from "./core.ts";

export interface RelayApp {
	fetch: (request: Request) => Promise<Response>;
}

/**
 * Count the body as it streams and cut it off past the limit.
 *
 * The up-front check reads Content-Length, which a chunked request — the case
 * `message/ohttp-chunked-req` exists for — arrives without. `over` is read
 * after the fetch settles: erroring the request stream surfaces as a transport
 * failure, not as our own error object.
 *
 * A transform only runs while something pulls it, so this counts only what the
 * gateway actually reads. A gateway that answers before draining gets its
 * response passed through with no 413 — nothing over the limit was forwarded
 * either way, but the client sees a different answer than it would on Node,
 * where server.ts counts the bytes as they arrive.
 */
function limitBody(
	body: ReadableStream<Uint8Array>,
	limit: number,
): { body: ReadableStream<Uint8Array>; over: () => boolean } {
	let seen = 0;
	let over = false;
	return {
		body: body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					seen += chunk.byteLength;
					if (seen > limit) {
						over = true;
						throw new Error("body exceeds the relay limit");
					}
					controller.enqueue(chunk);
				},
			}),
		),
		over: () => over,
	};
}

export function createApp(config: RelayConfig): RelayApp {
	const fetcher = config.fetcher ?? fetch;
	const cors = corsHeaders(config.corsOrigin);

	return {
		async fetch(request: Request): Promise<Response> {
			const { method } = request;
			if (method === "OPTIONS") {
				return new Response(null, { status: 204, headers: cors });
			}

			if (method === "GET" && new URL(request.url).pathname === "/health") {
				return new Response("OK", {
					headers: { ...cors, "Content-Type": "text/plain;charset=UTF-8" },
				});
			}

			const contentType = request.headers.get("Content-Type") ?? undefined;
			if (method === "POST") {
				const bad = rejectPost(
					contentType,
					request.headers.get("Content-Length") ?? undefined,
					config.maxRequestSize,
				);
				if (bad) {
					return new Response(JSON.stringify({ error: bad.error }), {
						status: bad.status,
						headers: { ...cors, "Content-Type": "application/json" },
					});
				}
			}

			const sends = method !== "GET" && method !== "HEAD";
			const limited =
				sends && request.body !== null
					? limitBody(request.body, config.maxRequestSize)
					: undefined;

			let upstream: Response;
			try {
				upstream = await fetcher(config.gatewayUrl, {
					method,
					headers: forwardHeaders(
						contentType,
						request.headers.get("Incremental") ?? undefined,
					),
					...(sends && {
						body: limited?.body ?? request.body,
						duplex: "half",
					}),
				} as RequestInit);
			} catch (error) {
				if (limited?.over() !== true) throw error;
				return new Response(
					JSON.stringify({
						error: `Request exceeds ${config.maxRequestSize} byte limit`,
					}),
					{
						status: 413,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}

			// Rebuilt rather than mutated: fetch Response headers are immutable
			// in Node, and set() collapses any the gateway already sent.
			const headers = new Headers(
				stripHopByHop(Object.fromEntries(upstream.headers)),
			);
			for (const [name, value] of Object.entries(cors))
				headers.set(name, value);
			return new Response(upstream.body, {
				status: upstream.status,
				statusText: upstream.statusText,
				headers,
			});
		},
	};
}
