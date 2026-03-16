# ohttp-relay

[![License](https://img.shields.io/github/license/thibmeu/ohttp-relay?style=flat-square)](LICENSE)

An [Oblivious HTTP (RFC 9458)](https://www.rfc-editor.org/rfc/rfc9458) relay.

Forwards encrypted OHTTP requests to a gateway without decrypting them, preserving client privacy. The gateway only ever sees the relay's IP address, not the client's.

## Table of Contents

- [Deploy](#deploy)
- [Configuration](#configuration)
  - [Cloudflare service binding](#cloudflare-service-binding)
  - [Netlify configuration](#netlify-configuration)
- [Protocol](#protocol)
- [Development](#development)
- [Architecture](#architecture)
- [License](#license)

## Deploy

| Platform | | Runtime |
|---|---|---|
| Cloudflare | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thibmeu/ohttp-relay) | Workers |
| Vercel | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fthibmeu%2Fohttp-relay&env=GATEWAY_URL&envDescription=Base+URL+of+the+OHTTP+gateway&envLink=https%3A%2F%2Fgithub.com%2Fthibmeu%2Fohttp-relay%23configuration&project-name=ohttp-relay&repository-name=ohttp-relay) | Edge |
| Netlify | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/thibmeu/ohttp-relay) | Edge (Deno) |
| Railway | [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/ohttp-relay) | Node.js |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_URL` | `https://gateway.ohttp.info/ohttp` | Full URL of the gateway's oblivious request resource |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `MAX_REQUEST_SIZE` | `1048576` | Maximum request body size (bytes) |
| `PORT` | `3000` | Listening port (Node.js only) |

### Cloudflare service binding

If you deploy [ohttp-gateway](https://github.com/thibmeu/ohttp-gateway) as a Cloudflare Worker named `ohttp-gateway` in the same account, you can enable a service binding for lower latency (no extra network hop):

1. Uncomment the `[[services]]` block in `wrangler.toml`

### Netlify configuration

Netlify's deploy button does not support prompting for environment variables. After deploying, set `GATEWAY_URL` manually in **Site settings → Environment variables**.

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

## Architecture

```
Client → Relay → Gateway → Target
           ↑
    (this service)
```

The relay is a pure passthrough — it never decrypts OHTTP messages. This is what provides the privacy guarantee: the gateway learns what the client requested but not who made the request; the relay knows who made the request but not what was requested.

## License

This project is licensed under the [MIT License](LICENSE).
