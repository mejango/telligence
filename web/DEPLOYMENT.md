# Web deployment

The Telligence webclient is the Revnet Money fork under `web/`. The active CI and
release workflows are at the repository root. The complete Railway topology,
manifest, funded-canary gates, incident recovery, and image promotion procedure
are in [../DEPLOYING.md](../DEPLOYING.md).

Build from this directory with the public values in `.env.example`:

```sh
npm ci --ignore-scripts
npm run audit:production
npm run check
npm run build
```

`build:browser` is the deterministic production-shaped test build. Deploy with
`build` or the Dockerfile so fixture transport configuration is never shipped.
The Dockerfile uses pinned Node 26.5.0/npm 12.0.1, standalone output, an unprivileged
UID/GID 1001, and a process-only `/api/healthz` check. Railway derives the immutable
revision from `RAILWAY_GIT_COMMIT_SHA`. Runtime server reads use the fixed
`TELLIGENCE_GATEWAY_URL`; public build values never contain backend secrets.

Set Railway's web root to `/web`, then use `railway.json`. Keep
`NEXT_PUBLIC_SITE_URL` identical to the web's public origin. The same-origin
`/api/telligence` proxy preserves creator authentication/CSRF boundaries;
applications use the gateway's separate public `/api/v1` URL for inference.

Run the image with a read-only root, dropped capabilities, no-new-privileges,
and a writable bounded `/app/.next/cache` owned by UID/GID 1001. Keep the inherited
Safe frame allowlist and do not add `X-Frame-Options`. Restrict image
optimization to the existing allowlist. Juicebox Center owns its own pinning,
RPC credentials, trusted-origin policy, and quotas; browsers use its
credential-free SDK, never an app-owned provider-secret proxy.

For independent onchain recovery during a gateway outage, set
`NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS` at build time to the verified Base
factory address. Leaving it absent keeps recovery unconfigured. Publishing a
value does not substitute for runtime/source verification or an audit.
