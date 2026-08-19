/**
 * Node server tests. These run over real sockets rather than calling a handler
 * directly, because what they check — which headers actually reach the gateway
 * — is decided by the HTTP client, not by our code.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MediaType } from "ohttp-ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RelayConfig } from "../src/core.ts";
import { createRelayServer } from "../src/server.ts";

/** Gateway stand-in: reports exactly what it received. */
let gateway: Server;
let gatewayUrl: string;
let seen: {
	headers: Record<string, string | string[] | undefined>;
	bytes: number;
};

beforeAll(async () => {
	gateway = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			seen = { headers: req.headers, bytes: Buffer.concat(chunks).length };
			res.writeHead(200, { "Content-Type": MediaType.RESPONSE });
			res.end("encapsulated response");
		});
	});
	gatewayUrl = await listen(gateway);
});

afterAll(() => gateway.close());

const config = { maxRequestSize: 1_048_576, corsOrigin: "*" };

async function listen(server: Server): Promise<string> {
	await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Runs against the shared gateway unless `overrides` names another one. */
async function withRelay<T>(
	overrides: Partial<RelayConfig>,
	run: (base: string) => Promise<T>,
): Promise<T> {
	const relay = createRelayServer({ ...config, gatewayUrl, ...overrides });
	const base = await listen(relay);
	try {
		return await run(base);
	} finally {
		relay.close();
	}
}

describe("node server", () => {
	it("serves a health check without forwarding", async () => {
		await withRelay({}, async (base) => {
			const res = await fetch(`${base}/health`);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("OK");
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
		});
	});

	it("rejects an unexpected content-type with 415", async () => {
		await withRelay({}, async (base) => {
			const res = await fetch(base, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "x",
			});
			expect(res.status).toBe(415);
		});
	});

	// Small enough that the whole body is already buffered when the relay
	// answers. A client still uploading when the socket goes away sees a reset
	// instead — the response is written, but nothing can be done about the
	// framing of a request we refused to read.
	it("rejects an oversized body with 413", async () => {
		await withRelay({ maxRequestSize: 16 }, async (base) => {
			const res = await fetch(base, {
				method: "POST",
				headers: { "Content-Type": MediaType.REQUEST },
				body: Buffer.alloc(100, 1),
			});
			expect(res.status).toBe(413);
		});
	});

	it("answers preflight without forwarding", async () => {
		await withRelay({}, async (base) => {
			const res = await fetch(base, { method: "OPTIONS" });
			expect(res.status).toBe(204);
			expect(res.headers.get("access-control-allow-methods")).toContain("POST");
		});
	});

	it("streams the encapsulated body through untouched", async () => {
		await withRelay({}, async (base) => {
			const res = await fetch(base, {
				method: "POST",
				headers: { "Content-Type": MediaType.REQUEST },
				body: Buffer.alloc(5000, 7),
			});
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("encapsulated response");
			expect(res.headers.get("content-type")).toBe(MediaType.RESPONSE);
			expect(seen.bytes).toBe(5000);
		});
	});

	// The relay's whole job: the gateway learns nothing about the client. This
	// is why the Node path forwards over node:http — global fetch (undici)
	// appends accept, accept-language, sec-fetch-mode, user-agent and
	// accept-encoding of its own, which this asserts we do not send.
	it("forwards only Content-Type and Incremental", async () => {
		await withRelay({}, async (base) => {
			await fetch(base, {
				method: "POST",
				headers: {
					"Content-Type": MediaType.CHUNKED_REQUEST,
					Incremental: "?1",
					Cookie: "session=secret",
					Authorization: "Bearer token",
					"User-Agent": "client-browser/9",
					Referer: "https://example.com/page",
					"X-Forwarded-For": "203.0.113.7",
					"Accept-Language": "en-GB",
				},
				body: "x",
			});

			expect(seen.headers["content-type"]).toBe(MediaType.CHUNKED_REQUEST);
			expect(seen.headers.incremental).toBe("?1");

			// The exact set, not a denylist: anything node:http or a future edit
			// adds shows up here rather than passing because nobody listed it.
			// host and connection are the client leg's own framing, added by the
			// agent we forward with, not carried over from the client.
			expect(Object.keys(seen.headers).sort()).toEqual([
				"connection",
				"content-type",
				"host",
				"incremental",
				"transfer-encoding",
			]);
		});
	});

	// Verified against the pre-fix code: 102400 bytes reached the gateway
	// through a relay configured with maxRequestSize 16, answered 200. A
	// chunked request carries no Content-Length for the up-front check to read.
	it("cuts off a chunked body with no content-length at the limit", async () => {
		await withRelay({ maxRequestSize: 16 }, async (base) => {
			seen = { headers: {}, bytes: 0 };
			const res = await fetch(base, {
				method: "POST",
				headers: { "Content-Type": MediaType.CHUNKED_REQUEST },
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(102_400));
						controller.close();
					},
				}),
				// @ts-expect-error duplex is not in the DOM lib types yet
				duplex: "half",
			});
			expect(res.status).toBe(413);
			expect(seen.bytes).toBeLessThanOrEqual(16);
		});
	});

	it("does not relay the gateway's per-connection headers", async () => {
		const nosy = createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(200, {
					"Content-Type": MediaType.RESPONSE,
					Connection: "close",
					"Keep-Alive": "timeout=1",
					"Set-Cookie": "gwtrack=1",
					"Proxy-Authenticate": "Basic",
				});
				res.end("ok");
			});
		});
		try {
			await withRelay({ gatewayUrl: await listen(nosy) }, async (base) => {
				const res = await fetch(base, {
					method: "POST",
					headers: { "Content-Type": MediaType.REQUEST },
					body: "x",
				});
				expect(res.headers.get("content-type")).toBe(MediaType.RESPONSE);
				for (const hop of ["set-cookie", "proxy-authenticate"]) {
					expect(res.headers.get(hop), `${hop} must not reach the client`).toBe(
						null,
					);
				}
				// connection and keep-alive belong to the client leg, and Node writes
				// its own. What matters is that the gateway's values are not the ones
				// the client sees: "close" would end the keep-alive this relay wants.
				expect(res.headers.get("connection")).not.toBe("close");
				expect(res.headers.get("keep-alive")).not.toBe("timeout=1");
			});
		} finally {
			nosy.close();
		}
	});

	it("keeps the gateway's status line", async () => {
		const busy = createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(429, "Slow Down");
				res.end();
			});
		});
		try {
			await withRelay({ gatewayUrl: await listen(busy) }, async (base) => {
				const res = await fetch(base, {
					method: "POST",
					headers: { "Content-Type": MediaType.REQUEST },
					body: "x",
				});
				expect(res.status).toBe(429);
				expect(res.statusText).toBe("Slow Down");
			});
		} finally {
			busy.close();
		}
	});

	it("destroys the gateway leg when the client hangs up", async () => {
		let opened = 0;
		let droppedByRelay = 0;
		// Never answers: the exchange is still open when the client hangs up.
		const slow = createServer((req, res) => {
			opened++;
			req.resume();
			res.on("close", () => {
				if (!res.writableEnded) droppedByRelay++;
			});
		});
		try {
			await withRelay({ gatewayUrl: await listen(slow) }, async (base) => {
				const abort = new AbortController();
				const inflight = fetch(base, {
					method: "POST",
					headers: { "Content-Type": MediaType.CHUNKED_REQUEST },
					body: "x".repeat(1024),
					signal: abort.signal,
				}).catch(() => undefined);
				await new Promise((ok) => setTimeout(ok, 100));
				abort.abort();
				await inflight;
				await new Promise((ok) => setTimeout(ok, 300));
				expect(opened).toBe(1);
				expect(droppedByRelay).toBe(1);
			});
		} finally {
			slow.close();
		}
	});

	it("returns 502 when the gateway is unreachable", async () => {
		await withRelay({ gatewayUrl: "http://127.0.0.1:1" }, async (base) => {
			const res = await fetch(base, {
				method: "POST",
				headers: { "Content-Type": MediaType.REQUEST },
				body: "x",
			});
			expect(res.status).toBe(502);
		});
	});
});
