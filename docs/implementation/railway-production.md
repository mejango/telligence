# Railway production deployment

Hosted in [the Telligence Railway project](https://railway.com/project/b7502552-4222-4aa3-ad69-9bc729265387), production environment `82e7109b-357e-40f6-9088-61ed774e62f6`, on 2026-09-09.

The public web origin is configured as `https://telligence.money`. The working
Railway preview is https://web-production-24f6d.up.railway.app. The gateway API
base is https://gateway-production-389d.up.railway.app/api/v1.

## Released web artifact

The final web deployment is `SUCCESS`. Its `/api/healthz` returned HTTP 200 with
the exact source revision below after deployment.

| Identity | Value |
| --- | --- |
| Service | `6a3a5f99-b549-40fd-92f6-11b308671ef6` |
| Deployment | `34ce895e-a41e-44af-b13b-0a79febec9cb` |
| Source revision | `source-9c811232397ff34b7a7c71692545f0f7a7897c5aba028c39b7c8c81ae08063b5` |
| Image digest | `sha256:452d0592f7a91b25902b6d1172af34880aeadd38c1bf259f7bd66cc9b8522b01` |

The source identifier records the uploaded web context; it is not a Git commit.
The previous web release used
`source-c5723220c4423def002e27482a5f8a88cc719a70eb769d10be08e29690713da5`.
Rolling back to that release also restores the sign-in hydration issue described
below. Backend deployment identities are recorded separately.

## Domain connection pending

Railway has both custom domains attached to web port 3000. Authoritative
Namecheap DNS still points to the former Railway hostname and old ownership
record; both domains report unverified and certificates validating ownership.
The required Namecheap changes are:

| Type | Host | Value | Action |
| --- | --- | --- | --- |
| ALIAS | `@` | `hybpwzrj.up.railway.app` | Replace the existing apex CNAME. |
| CNAME | `www` | `nwi7odx9.up.railway.app` | Replace the old routing value. |
| TXT | `_railway-verify` | `railway-verify=851aacbdec7a3557516d278c918a73db6f144de77a1f95991ff74a0e9cf762a7` | Replace the old Railway verification value. |
| TXT | `_railway-verify.www` | `railway-verify=851cf77c1112801329aa1de589f508048962556c68e18425bca39fc61f74359f` | Add. |

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
TypeScript, lint, and formatting passed. On the final deployed revision, a fresh
page's first enabled Sign in click opened the email dialog with its input enabled
and no exception. No credentials were submitted during that check.

The gateway reports ready database health; the web reaches it through
`gateway.railway.internal`. The project directory contains no seeded projects.

## Compute activation remains gated

Hosting readiness does not activate fundraising or inference. The gateway
correctly reports `ready:false` with no factory, policy version, or launch policy.
There are no projects, application keys, provider bindings, or verified canaries.
Inference reports pricing unavailable; worker readiness reports awaiting
configuration. No contracts were deployed and no funded inference was run.

Complete the reviewed Base factory/manifest and funded Venice acceptance work in
[DEPLOYING.md](../../DEPLOYING.md) before enabling those capabilities.
