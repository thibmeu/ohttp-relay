/**
 * OHTTP Relay — Node.js HTTP server (Railway / self-hosted)
 *
 * Runs the relay as a plain Node.js HTTP server.
 * Requires Node.js 18+ for built-in Web APIs (Request, Response, fetch).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleRequest } from "./relay";

const config = {
	gatewayUrl: process.env.GATEWAY_URL ?? "https://gateway.ohttp.info",
	maxRequestSize: parseInt(process.env.MAX_REQUEST_SIZE ?? "1048576", 10),
	corsOrigin: process.env.CORS_ORIGIN ?? "*",
};

async function nodeRequestToWeb(req: IncomingMessage): Promise<Request> {
	const host = req.headers.host ?? "localhost";
	const url = new URL(req.url ?? "/", `http://${host}`);

	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (typeof value === "string") {
			headers.set(key, value);
		} else if (Array.isArray(value)) {
			for (const v of value) {
				headers.append(key, v);
			}
		}
	}

	return new Request(url.toString(), {
		method: req.method ?? "GET",
		headers,
		body: body && body.length > 0 ? body : undefined,
		// @ts-expect-error — Node.js requires duplex for request bodies
		duplex: "half",
	});
}

async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
	res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
	if (webRes.body) {
		const reader = webRes.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			res.write(value);
		}
	}
	res.end();
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
	try {
		const webRequest = await nodeRequestToWeb(req);
		const webResponse = await handleRequest(webRequest, config);
		await writeWebResponse(webResponse, res);
	} catch (error) {
		console.error("Server error:", error);
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Internal server error" }));
	}
});

const port = parseInt(process.env.PORT ?? "3000", 10);
server.listen(port, () => {
	console.log(`ohttp-relay listening on port ${port}`);
});
