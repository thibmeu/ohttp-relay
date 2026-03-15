# ohttp-relay

An [Oblivious HTTP (RFC 9458)](https://www.rfc-editor.org/rfc/rfc9458) relay.

Forwards encrypted OHTTP requests to a gateway without decrypting them, preserving client privacy. The gateway only ever sees the relay's IP address, not the client's.

## Deploy

| Platform | | Runtime |
|---|---|---|
| Cloudflare | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thibmeu/ohttp-relay) | Workers |
| Vercel | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fthibmeu%2Fohttp-relay&env=GATEWAY_URL&envDescription=Base+URL+of+the+OHTTP+gateway&envLink=https%3A%2F%2Fgithub.com%2Fthibmeu%2Fohttp-relay%23configuration&project-name=ohttp-relay&repository-name=ohttp-relay) | Edge |
| Netlify | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/thibmeu/ohttp-relay) | Edge (Deno) — set `GATEWAY_URL` in site settings after deploy |
| Railway | [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/ohttp-relay) | Node.js |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_URL` | `https://gateway.ohttp.info` | Base URL of the OHTTP gateway |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `MAX_REQUEST_SIZE` | `1048576` | Maximum request body size (bytes) |
| `PORT` | `3000` | Listening port (Node.js only) |

## Protocol

All requests are forwarded to the gateway at the same path. The `Content-Type` header determines the OHTTP variant:

| Content-Type | Description |
|---|---|
| `message/ohttp-req` | Standard OHTTP (RFC 9458) |
| `message/ohttp-chunked-req` | Chunked OHTTP (streaming) |

## Development

```bash
npm install

# Cloudflare Workers (wrangler dev)
npm run dev

# Node.js server
npm start
```

## Cloudflare service binding

If you deploy [ohttp-gateway](https://github.com/thibmeu/ohttp-gateway) as a Cloudflare Worker named `ohttp-gateway` in the same account, you can enable a service binding for lower latency (no extra network hop):

1. Uncomment the `[[services]]` block in `wrangler.toml`
2. Set `USE_SERVICE_BINDING = "true"` in `[vars]`

## Architecture

```
Client → Relay → Gateway → Target
           ↑
    (this service)
```

The relay is a pure passthrough — it never decrypts OHTTP messages. This is what provides the privacy guarantee: the gateway learns what the client requested but not who made the request; the relay knows who made the request but not what was requested.
