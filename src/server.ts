/**
 * OHTTP Relay — Node.js server entry point (Railway / self-hosted)
 */

import { serve } from "@hono/node-server";
import { createApp } from "./relay";

const app = createApp({
	gatewayUrl: process.env.GATEWAY_URL ?? "https://gateway.ohttp.info",
	maxRequestSize: parseInt(process.env.MAX_REQUEST_SIZE ?? "1048576", 10),
	corsOrigin: process.env.CORS_ORIGIN ?? "*",
});

serve(
	{
		fetch: app.fetch,
		port: parseInt(process.env.PORT ?? "3000", 10),
	},
	(info) => {
		console.log(`ohttp-relay listening on port ${info.port}`);
	},
);
