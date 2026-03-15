# ohttp-relay

An [Oblivious HTTP (RFC 9458)](https://www.rfc-editor.org/rfc/rfc9458) relay.

Forwards encrypted OHTTP requests to a gateway without decrypting them, preserving client privacy. The gateway only ever sees the relay's IP address, not the client's.

## Deploy

| Platform | | Runtime |
|---|---|---|
| Cloudflare Workers | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thibmeu/ohttp-relay) | Workers (native) |
| Vercel | [![Deploy with Vercel](https://vercel.com/button.svg)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fthibmeu%2Fohttp-relay&env=GATEWAY_URL&envDescription=Base+URL+of+the+OHTTP+gateway&envLink=https%3A%2F%2Fgithub.com%2Fthibmeu%2Fohttp-relay%23configuration&project-name=ohttp-relay&repository-name=ohttp-relay) | Edge |
| Netlify | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/thibmeu/ohttp-relay) | Edge (Deno) |
| Railway | [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/ohttp-relay) | Node.js |

Fly.io does not have a deploy button. Use the CLI:

```bash
fly launch --no-deploy
fly secrets set GATEWAY_URL=https://gateway.ohttp.info
fly deploy
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_URL` | `https://gateway.ohttp.info` | Base URL of the OHTTP gateway |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `MAX_REQUEST_SIZE` | `1048576` | Maximum request body size (bytes) |
| `PORT` | `3000` | Listening port (Node.js only) |

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/ohttp` | POST | Forward OHTTP encapsulated request to gateway |
| `/chunked-ohttp` | POST | Forward chunked (streaming) OHTTP request |
| `/ohttp-config` | GET | Proxy gateway key configuration |
| `/health` | GET | Health check |

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
