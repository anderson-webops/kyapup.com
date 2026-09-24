# Vitesse Nuxt Full-Stack Template

This repository adapts [antfu/vitesse-nuxt](https://github.com/antfu/vitesse-nuxt) into an npm workspace with two intentionally separate applications:

- `front-end/`: a statically generated Nuxt 4 application
- `back-end/`: a standalone Express 5 API

The browser always calls the API through the same-origin `/api` path. Local development, direct Nginx/systemd
production, and Netlify each route that path to the Express application without enabling broad CORS access.

## Supported toolchain

- Node.js `24.18.1`
- npm `12.0.2`

Use the repository root for all package operations. The committed npm lockfile includes optional native packages for Linux ARM64 glibc and musl deployments, and npm rejects unreviewed dependency install scripts.

npm uses the nested install strategy so optional peer packages from unrelated tools cannot leak across workspace boundaries. Direct build-time type and lint dependencies are declared explicitly rather than relying on accidental hoisting.

```bash
npm ci
npm run server
npm run dev
```

The API listens on `127.0.0.1:3006` by default, while Nuxt listens on port `3333` and proxies `/api` to it. Copy `.env.example` only when local listener settings need to change.

## Validation

```bash
npm run audit:all
npm run audit:prod
npm run validate
npm run a11y
```

`npm run validate` checks Linux ARM64 lockfile entries, linting, type safety, API behavior, both production builds, and the expected deployment artifacts.

## API contract

The starter API is deliberately public and read-only:

- `GET`/`HEAD /healthz` and `/api/healthz` provide minimal liveness; `/api/health` remains compatible.
- `GET`/`HEAD /readyz` and `/api/readyz` return `200` when ready or `503` when unavailable/stopping. GET returns only `{ "ok": true }` or `{ "ok": false }`; HEAD has no body. Probes set `Cache-Control: no-store` and never create cookies, redirects, sessions or diagnostics.
- `HEAD` and `OPTIONS` are permitted.
- Other methods return `405`, and unknown routes return JSON `404` responses.

There are no accounts, sessions, roles, promotion, or demotion workflows in this template. Do not infer authorization from the frontend, CORS, or a hidden route. Any downstream application that adds protected data must add authenticated, server-enforced authorization and tests at the Express boundary. See `docs/security-model.md`.

## Direct production deployment

Production does not use Docker or Compose. Nginx serves the generated Nuxt files and proxies `/api` to a loopback-only
Node process running as the unprivileged `vitesse-template` account under a hardened systemd service. Release
preparation requires the exact annotated tag and fetched `origin/main`, performs clean development and production-only
installs, audits and package-provenance checks, code/browser/accessibility validation, and a real direct runtime smoke
test. Promotion selects the prepared release atomically and rolls back automatically unless health, exact release
identity, strict headers, and the read-only API policy pass over both local IPv4 and IPv6 TLS paths.

```bash
sudo deploy/systemd/install-service.sh
# Install deploy/nginx/vitesse-nuxt-template.server.conf inside the certificate-covered TLS server.
deploy/systemd/prepare-release.sh /srv/vitesse-nuxt-template/releases/<release>
sudo PUBLIC_HOST=site.example deploy/systemd/promote-release.sh /srv/vitesse-nuxt-template/releases/<release>
```

See `deploy/README.md` for the exact rollout and rollback contract. The direct API never binds a public interface.
See `docs/runtime-artifact-contract.md` for the independent Linux ARM64 artifact,
hash verification and isolated runtime acceptance. Existing installed paths and
ports remain the operator's contract; adopting this template does not authorize
replacing a live host topology.

## Netlify deployment

Netlify generates the Nuxt frontend and bundles the same Express app as `netlify/functions/api.ts`. The first rewrite in `netlify.toml` sends `/api/*` to that function before the static SPA fallback. Node and npm versions are pinned in the repository and in Netlify configuration.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | API listener address |
| `PORT` | `3006` | API listener port |
| `TRUST_PROXY_HOPS` | `0` | Number of explicitly trusted reverse-proxy hops; direct production and Netlify set `1` |
| `DEV_API_ORIGIN` | `http://127.0.0.1:3006` | Nuxt development proxy target; it is never sent to browsers |

Do not commit secrets. This starter requires none.

## Git remotes

`origin` is the published monorepo template. `upstream` remains connected to `antfu/vitesse-nuxt` for selective upstream review; the workspace split is intentionally maintained locally.
