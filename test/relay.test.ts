import { MediaType } from "ohttp-ts";
import { describe, expect, it } from "vitest";
import { configFromEnv, createApp } from "../src/relay.ts";

const config = {
	gatewayUrl: "https://gateway.example/ohttp",
	maxRequestSize: 1_048_576,
	corsOrigin: "*",
};

describe("configFromEnv", () => {
	it("throws when GATEWAY_URL is missing instead of defaulting", () => {
		expect(() => configFromEnv(() => undefined)).toThrow(/GATEWAY_URL/);
		expect(() =>
			configFromEnv((k) => (k === "GATEWAY_URL" ? "" : undefined)),
		).toThrow(/GATEWAY_URL/);
	});

	it("uses the provided GATEWAY_URL and falls back for optional settings", () => {
		const cfg = configFromEnv((k) =>
			k === "GATEWAY_URL" ? "https://gateway.example/ohttp" : undefined,
		);
		expect(cfg.gatewayUrl).toBe("https://gateway.example/ohttp");
		expect(cfg.maxRequestSize).toBe(1_048_576);
		expect(cfg.corsOrigin).toBe("*");
	});
});

describe("relay", () => {
	it("serves a health check without forwarding", async () => {
		let forwarded = false;
		const app = createApp({
			...config,
			fetcher: async () => {
				forwarded = true;
				return new Response();
			},
		});
		const res = await app.fetch(new Request("https://relay/health"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("OK");
		expect(forwarded).toBe(false);
	});

	it("rejects a POST with an unknown content-type with 415", async () => {
		const app = createApp(config);
		const res = await app.fetch(
			new Request("https://relay/ohttp", {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "x",
			}),
		);
		expect(res.status).toBe(415);
	});

	it("rejects a body over the size limit with 413", async () => {
		const app = createApp({ ...config, maxRequestSize: 16 });
		const res = await app.fetch(
			new Request("https://relay/ohttp", {
				method: "POST",
				headers: {
					"Content-Type": MediaType.REQUEST,
					"Content-Length": "1024",
				},
				body: "x".repeat(1024),
			}),
		);
		expect(res.status).toBe(413);
	});

	it("strips identifying headers before forwarding to the gateway", async () => {
		let seen: Headers | undefined;
		let seenUrl: string | undefined;
		const app = createApp({
			...config,
			fetcher: async (input, init) => {
				seenUrl = String(input);
				seen = new Headers(init?.headers);
				return new Response("ok", { status: 200 });
			},
		});

		const res = await app.fetch(
			new Request("https://relay/ohttp", {
				method: "POST",
				headers: {
					"Content-Type": MediaType.REQUEST,
					Cookie: "session=secret",
					Authorization: "Bearer token",
					"User-Agent": "spy/1.0",
					"X-Forwarded-For": "203.0.113.7",
				},
				body: "encrypted",
			}),
		);

		expect(res.status).toBe(200);
		expect(seenUrl).toBe(config.gatewayUrl);
		// Only the OHTTP content-type survives; nothing that identifies the client.
		expect(seen?.get("Content-Type")).toBe(MediaType.REQUEST);
		expect(seen?.get("Cookie")).toBeNull();
		expect(seen?.get("Authorization")).toBeNull();
		expect(seen?.get("User-Agent")).toBeNull();
		expect(seen?.get("X-Forwarded-For")).toBeNull();
	});

	it("passes the gateway response body back to the client", async () => {
		const app = createApp({
			...config,
			fetcher: async () =>
				new Response("encapsulated response", {
					status: 200,
					headers: { "Content-Type": MediaType.RESPONSE },
				}),
		});
		const res = await app.fetch(
			new Request("https://relay/ohttp", {
				method: "POST",
				headers: { "Content-Type": MediaType.REQUEST },
				body: "encrypted",
			}),
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("encapsulated response");
	});
});
