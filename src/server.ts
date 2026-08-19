/**
 * OHTTP Relay — Node.js server entry point (Railway / self-hosted)
 *
 * Drives node:http on both sides rather than converting through the Fetch API,
 * for header hygiene: undici appends `accept`, `accept-language`,
 * `sec-fetch-mode`, `user-agent` and `accept-encoding` to every outbound
 * request. The client's own values are still stripped, so this is not a
 * client-identity leak, but it does contradict the forwarding contract in
 * core.ts and tells the gateway which runtime the relay is on. `http.request`
 * sends exactly the headers it is given, which the test suite asserts.
 *
 * The Fetch API handler in relay.ts is still what every edge platform uses.
 */

import {
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import {
	configFromEnv,
	corsHeaders,
	forwardHeaders,
	type RelayConfig,
	rejectPost,
	stripHopByHop,
} from "./core.ts";

/**
 * Cap on the gateway leg. http.request has no default timeout, so a gateway
 * that accepts a connection and then goes quiet would pin a client socket
 * until Node's 300 s requestTimeout reaps the inbound side.
 */
const GATEWAY_TIMEOUT_MS = 30_000;

export function createRelayServer(config: RelayConfig) {
	const cors = corsHeaders(config.corsOrigin);
	const gateway = new URL(config.gatewayUrl);
	const drive = gateway.protocol === "https:" ? httpsRequest : httpRequest;

	const send = (
		res: ServerResponse,
		status: number,
		body: string,
		contentType: string,
	) => {
		res.writeHead(status, { ...cors, "Content-Type": contentType });
		res.end(body);
	};

	return createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method === "OPTIONS") {
			res.writeHead(204, cors);
			res.end();
			return;
		}

		// Compare the path only: req.url carries the query string too.
		const path = (req.url ?? "/").split("?", 1)[0];
		if (req.method === "GET" && path === "/health") {
			send(res, 200, "OK", "text/plain;charset=UTF-8");
			return;
		}

		const contentType = req.headers["content-type"];
		if (req.method === "POST") {
			const bad = rejectPost(
				contentType,
				req.headers["content-length"],
				config.maxRequestSize,
			);
			if (bad) {
				send(
					res,
					bad.status,
					JSON.stringify({ error: bad.error }),
					"application/json",
				);
				return;
			}
		}

		// Set when we tear the gateway leg down ourselves, so the error that
		// follows is not logged as the gateway failing.
		let abandoned = false;

		const upstream = drive(
			{
				protocol: gateway.protocol,
				hostname: gateway.hostname,
				port: gateway.port,
				path: gateway.pathname + gateway.search,
				method: req.method,
				// req.headers keys are lowercased by node:http. The cast narrows an
				// index signature that is only ever an array for set-cookie.
				headers: forwardHeaders(
					contentType,
					req.headers.incremental as string | undefined,
				),
				timeout: GATEWAY_TIMEOUT_MS,
			},
			(gatewayRes) => {
				res.writeHead(gatewayRes.statusCode ?? 502, gatewayRes.statusMessage, {
					...stripHopByHop(gatewayRes.headers),
					...cors,
				});
				gatewayRes.pipe(res);
			},
		);

		upstream.on("error", (error) => {
			if (abandoned) return;
			console.error("Gateway request failed:", error);
			if (!res.headersSent) res.writeHead(502, cors);
			res.end();
		});

		upstream.on("timeout", () => upstream.destroy());

		// A client that hangs up mid-exchange otherwise leaves the gateway leg
		// open, holding a socket on both hops until Node's requestTimeout fires.
		res.on("close", () => {
			if (res.writableEnded) return;
			abandoned = true;
			upstream.destroy();
		});

		if (req.method === "GET" || req.method === "HEAD") {
			upstream.end();
			return;
		}

		// Stream the encapsulated body straight through; the relay never reads
		// it. Content-Length was checked up front, but a chunked request — the
		// case message/ohttp-chunked-req exists for — arrives without one, so
		// the limit has to be enforced as the bytes go past.
		let received = 0;
		req.on("data", (chunk: Buffer) => {
			received += chunk.length;
			if (received <= config.maxRequestSize) return;
			req.unpipe(upstream);
			abandoned = true;
			upstream.destroy();
			if (!res.headersSent) {
				// connection: close because the request framing is left unfinished —
				// the socket cannot be reused. A client still uploading when the
				// socket goes away sees a reset rather than this response; that is
				// the cost of not reading a body we have already refused.
				res.writeHead(413, {
					...cors,
					"Content-Type": "application/json",
					connection: "close",
				});
				res.end(
					JSON.stringify({
						error: `Request exceeds ${config.maxRequestSize} byte limit`,
					}),
				);
			}
			req.destroy();
		});
		req.pipe(upstream);
	});
}

// Started directly (`node src/server.ts`), not when imported by a test.
if (import.meta.main) {
	const port = Number.parseInt(process.env.PORT ?? "3000", 10);
	createRelayServer(configFromEnv((k) => process.env[k])).listen(
		port,
		"0.0.0.0",
		() => console.log(`ohttp-relay listening on port ${port}`),
	);
}
