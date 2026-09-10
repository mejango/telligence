# Railway production deployment

Hosted in [the Telligence Railway project](https://railway.com/project/b7502552-4222-4aa3-ad69-9bc729265387), production environment `82e7109b-357e-40f6-9088-61ed774e62f6`, on 2026-09-09.

The public web origin is configured as `https://telligence.money`. The working
Railway preview is https://web-production-24f6d.up.railway.app. The gateway API
base is https://gateway-production-389d.up.railway.app/api/v1.

## Released GitHub web artifact

The GitHub web deployment is `SUCCESS`. The public site's `/api/healthz`
returned HTTP 200 with the exact Git commit below after deployment.

| Identity | Value |
| --- | --- |
| Service | `6a3a5f99-b549-40fd-92f6-11b308671ef6` |
| Deployment | `082d64ab-1512-45e1-b93a-1c07222d8336` |
| Created | `2026-09-09T23:14:47.971Z` |
| Git commit | `72673c735f6df7f71187e3a25d930ed06f268297` |
| Image digest | `sha256:278dc0663141600c154167703089ce9c58157955d212a9a3be1ce6a506213366` |

The previous verified CLI release is retained here for rollback identification:

| Identity | Value |
| --- | --- |
| Deployment | `34ce895e-a41e-44af-b13b-0a79febec9cb` |
| Source revision | `source-9c811232397ff34b7a7c71692545f0f7a7897c5aba028c39b7c8c81ae08063b5` |
| Image digest | `sha256:452d0592f7a91b25902b6d1172af34880aeadd38c1bf259f7bd66cc9b8522b01` |

That CLI source identifier records the uploaded web context; it is not a Git
commit. An earlier CLI release used
`source-c5723220c4423def002e27482a5f8a88cc719a70eb769d10be08e29690713da5`.
Rolling back to that release also restores the sign-in hydration issue described
below. Backend deployment identities are recorded separately.

## GitHub deployment transition

The web service is now connected to `mejango/telligence`, branch `main`. Its
first GitHub build failed because root `/` had no `Dockerfile`; the web image
requires the `web/` build context. The corrected settings were applied directly:

| Setting | Value |
| --- | --- |
| Root directory | `/web` |
| Builder / Dockerfile | `DOCKERFILE` / `Dockerfile` |
| Watch path, relative to repository root | `/web/**` |
| Healthcheck / port | `/api/healthz` / `3000` |
| Custom build/start commands | Unset; use the Dockerfile |
| Railway config-file override | None |
| Manual `NEXT_PUBLIC_VERSION` | Removed |

The Dockerfile now falls back to GitHub's `RAILWAY_GIT_COMMIT_SHA` for both the
built application and runtime revision. The earlier CLI source identifier must
not remain as a version override. Railway rejected setting `railwayConfigFile`
as deprecated; the retained `web/railway.json` is a legacy reference, not the
active configuration authority. See [Railway's notice](https://docs.railway.com/config-as-code).

A CLI `railway redeploy` retained the earlier deployment's root and manifest.
A fresh `serviceInstanceDeployV2` deployment applied the corrected service
settings and succeeded with the GitHub artifact recorded above. The public
configuration proxy also returned HTTP 200 with `ready:false`, as expected
while compute deployment remains unconfigured.

## Domain connection verified

Both custom domains are active on web port 3000 with normal TLS verification.
`https://telligence.money/api/healthz` returned HTTP 200 and the verified Git
commit recorded above. `https://www.telligence.money/create?check=repo`
returned HTTP 308 to exactly `https://telligence.money/create?check=repo`.
These checks verify domain routing, certificates, and the served revision.

Namecheap routing configuration reference:

| Type | Host | Value |
| --- | --- | --- |
| ALIAS | `@` | `hybpwzrj.up.railway.app` |
| CNAME | `www` | `nwi7odx9.up.railway.app` |

Existing email MX and SPF records are independent and must be preserved. The
application redirects www to the apex, retaining paths and query parameters.
Certificate validation was not bypassed during the public-domain checks.

## Services and configuration

[Backend deployment metadata](railway-backend-deployment.json) records exact
service/deployment IDs and image digests. Gateway, private signer, private worker,
and PostgreSQL are running. [Private health checks](railway-private-health.jsonl)
verify authenticated internal connectivity and the database migration. The
PostgreSQL template runs version 18.6. There are no public domains or TCP proxies
on PostgreSQL, the signer, or the worker.

Gateway uses `node db/migrate.mjs` as its pre-deploy command, `/readyz` for traffic
admission, and 140 seconds of draining for its 130-second request shutdown. The
signer and worker use `/healthz`. Gateway and worker listen on both address
families. All services have one replica. The worker has no keeper key and
execution remains disabled.

Fresh production secrets were generated separately from development and verified
per service. Only the signer receives `SIGNER_ENCRYPTION_KEY`; only the gateway
receives `API_KEY_PEPPER`; the web receives neither those values nor database or
service credentials. An owner-only, gitignored local backup is at
`artifacts/local/production-backend-secrets-20260909.json`. It was excluded from
all upload contexts.

The web uses the public Para PROD application already shared by Juicebox.
[Free integration checks](railway-public-integrations.md) verified anonymous
startup and partner configuration with the actual Telligence Origin, and a Base
chain-ID request through Juicebox Center. No user signup, wallet creation, signing,
or paid provider operation was performed. Local wallet metadata identifies
Telligence; the shared provider's portal branding is Juicebox.

## Deployment procedure and checks

Services were uploaded from sanitized temporary contexts, without local env
files, credentials, dependencies, caches, or contract build artifacts. Backend
contexts include runtime SQL and generated contract ABIs. Web uses its own root
context. Railway's effective per-service Dockerfile, root, start, health and
pre-deploy settings were explicitly set and read back; uploaded config-file
presence alone did not establish effective settings in this CLI release.

The web image passed its production build and TypeScript. Live 1280px/390px
checks verified the homepage, purpose form, removed goal, 10% tax, and review,
with no overflow or uncaught JavaScript errors.

A cold-page probe of the initial release found that a sign-in click before
hydration could be ignored. The button now stays disabled until its handler is
ready. The [SSR-to-hydration regression first failed](railway-signin-hydration-red.log);
[all 21 focused wallet tests then passed](railway-signin-hydration-green.log).
TypeScript, lint, and formatting passed. On the CLI revision recorded above, a fresh
page's first enabled Sign in click opened the email dialog with its input enabled
and no exception. No credentials were submitted during that check.

The GitHub revision recorded above passed live checks at 1280px and 390px on
`https://telligence.money`: homepage HTTP 200 and heading, create-page heading,
and the first enabled Sign in click opening the dialog with its email/phone
input enabled. Both widths had no horizontal overflow or uncaught exceptions.
No signup or credentials were submitted.

The gateway reports ready database health; the web reaches it through
`gateway.railway.internal`. The project directory contains no seeded projects.

## Resilience hardening deployment, 2026-09-10

Backend images were rebuilt from the sanitized `services/` and `packages/`
context at commit `e5cbb8fbca046fc3b7b353e501f8e44bd8f02770` and uploaded
with `railway up --path-as-root`; the web service autodeployed commit
`25b3a9c64596d4e9ebe8e249837fcd1c2944fa3c` from GitHub. Deployment identities
and digests are in [railway-backend-deployment.json](railway-backend-deployment.json).

Effective changes to the production environment:

| Change | State |
| --- | --- |
| Database roles | `telligence_gateway`, `telligence_signer`, `telligence_worker` created with `node db/roles.mjs` from the gateway container; each service's `DATABASE_URL` is now its own role. The gateway keeps `MIGRATION_DATABASE_URL` (owner) for the pre-deploy migration only. |
| Signer credentials | `AUTH_SIGNER_GATEWAY_SECRET` and `AUTH_SIGNER_WORKER_SECRET` on the signer; the gateway and worker each carry their own value in `AUTH_SIGNER_SERVICE_SECRET`. The signer's obsolete `AUTH_SIGNER_SERVICE_SECRET` variable remains set but unread (this CLI release cannot unset variables); delete it in the dashboard. |
| Schema | `gateway_instances`, `usage_reservations.gateway_instance`, `usage_reservations.dispatched_at` applied by the pre-deploy migration. |
| Gateway domain | `api.telligence.money` is attached to the gateway service on port 8080 with a valid Let's Encrypt certificate, and `PUBLIC_API_BASE_URL` is `https://api.telligence.money/api/v1`; `GET /v1/config` reports it on both the direct and site-proxied paths. The Railway-provided gateway domain remains as a fallback. The registrar CNAME for `api` targets the value Railway assigned to this custom-domain record; recreating the record assigns a new target. |
| Secrets | Owner-only, gitignored local backup `artifacts/local/production-backend-secrets-20260910.json`. |

Verified after the redeploys: gateway `/healthz` and `/readyz` 200 and
`gateway.started` logged with an instance identity; signer and worker started
under their roles with no permission errors; `/v1/config` still reports
`ready:false`. No projects, keys, reservations, or canaries exist, so no
usage was affected by the lifecycle migration.

## Compute activation remains gated

Hosting readiness does not activate fundraising or inference. The gateway
correctly reports `ready:false` with no factory, policy version, or launch policy.
There are no projects, application keys, provider bindings, or verified canaries.
Inference reports pricing unavailable; worker readiness reports awaiting
configuration. No contracts were deployed and no funded inference was run.

Complete the reviewed Base factory/manifest and funded Venice acceptance work in
[DEPLOYING.md](../../DEPLOYING.md) before enabling those capabilities.
