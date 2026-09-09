# ADR 0001: retain Next.js and ship a standalone runtime

- Status: accepted
- Date: 2026-07-22
- Decision owners: Revnet frontend maintainers

## Context

Revnet is pre-production, so this is the least expensive point to challenge its
runtime choices. The production source is roughly 43,500 lines and includes 148
TSX/JSX modules. More importantly, it already uses the framework as a server,
not merely as a client bundler:

- 45 modules import Next APIs;
- 11 page/layout server entry points render project and discovery surfaces;
- 10 modules depend on server-only/cache behavior;
- four API routes provide Bendystraw, IPFS, pinning, and badge boundaries;
- dynamic SEO and social-sharing metadata are generated server-side; and
- ten modules use image optimization for local, IPFS, or ENS imagery.

The wallet, Safe, Relayr, contract parity, and transaction-review invariants are
framework-independent and must remain unchanged by an infrastructure upgrade.

## Options considered

### Keep the previous Next 14 and Yarn Classic baseline

This would have preserved the previously resolved dependency graph and deferred
framework and package-manager migration. It was rejected once registry
resolution and the full release-equivalent validation suite were available.

### Upgrade Next in place and emit its standalone server

This preserves the single deployable runtime while modernizing the dependency
graph. It requires rebuilding native and optional packages and running the
complete release suite as one reviewed change.

Standalone output traces only runtime dependencies, yields one OCI artifact,
keeps server rendering and metadata in the same process, and avoids coupling
deployment to Vercel.

### Vite/React Router plus a separate Hono API

This could produce a smaller static client artifact, but Revnet would still need
a server for metadata, image safety, Bendystraw proxying, IPFS
pinning, and shields. It would introduce two release artifacts, cross-origin
configuration, duplicated health/observability policy, and a rewrite of 45
Next-coupled modules. There is no measured user or operational benefit that
justifies that added failure surface.

### Replace React or adopt another full-stack framework

The wallet and protocol SDK ecosystem is React-oriented. A replacement would
rewrite the largest and most safety-sensitive surface while leaving all
external-chain and server integration concerns intact. This is not credible
without a product requirement that the current stack cannot meet.

## Decision

Retain React and Next's single-process runtime. Use Next 16.3.4, Node 26.5.0,
npm 12.0.1, and the repository's single `package-lock.json`. Ship
`output: "standalone"` in a digest-pinned, multi-stage, non-root OCI image. CI,
release, and Docker builds use `npm ci --ignore-scripts`; no second lockfile is
accepted.

Dependency or framework updates remain coupled to lockfile integrity, native
and optional-package resolution, the production build, browser suite, and OCI
smoke test.

Public build configuration is validated before compilation. Runtime secrets are
validated at process start. Per-chain RPC inputs are provider-neutral,
comma-separated fallback lists; no vendor credential is committed. Contract
deployments remain pinned to deploy-all-v6 commit
`316e9d4d3f9e1c5b41a5df7c0ad6183abbeccc7f`.

## Consequences

- One image runs on any OCI-compatible platform and can be rolled back by
  digest.
- Server rendering, social metadata, health, proxies, and the client remain
  one deployable unit.
- The runtime needs a writable `.next/cache` volume or tmpfs for image
  optimization; the rest of its filesystem can be read-only.
- `NEXT_PUBLIC_*` values are image build inputs and are permanently public.
  Changing them requires a rebuild. Runtime secret rotation only needs a
  restart/redeploy of the same digest.
- React 19 remains deferred until the complete wallet, protocol invariant, and
  browser suite passes against the resulting dependency graph.
- A future static-client split should require measured latency, cost, scaling,
  or isolation evidence—not aesthetic preference.

## Upgrade guardrails

Dependabot groups non-major JavaScript, action, and Docker updates weekly. Majors stay
separate for deliberate review. Every upgrade must pass the release-equivalent
gate, standalone check, bundle budgets, zero-egress browser suite, contract
parity, and OCI smoke test. No dependency audit is permitted to auto-fix or
force a breaking graph without the same review.
