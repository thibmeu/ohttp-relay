/**
 * OHTTP Relay — Node.js server entry point (Railway / self-hosted)
 */

import { serve } from "@hono/node-server";
import { configFromEnv, createApp } from "./relay.ts";

const app = createApp(configFromEnv((k) => process.env[k]));

serve(
	{
		fetch: app.fetch,
		port: Number.parseInt(process.env.PORT ?? "3000", 10),
		hostname: "0.0.0.0",
	},
	(info) => {
		console.log(`ohttp-relay listening on port ${info.port}`);
	},
);
