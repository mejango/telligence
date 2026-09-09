[![revnet badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Frevnet.money%2Fapi%2Fdata%2Fshields%3FprojectId%3D3%26chainId%3D1&query=%24.message&label=Revnet%20Network&cacheSeconds=3600)](https://revnet.money/base:3)

Revnet Money is the v6-only Revnet application. Project routes use
`<chain>:<projectId>` (for example, `/eth:3`).

This is a [wagmi](https://wagmi.sh) + [Next.js](https://nextjs.org) + Tailwind +
[Juicebox](https://juicebox.money) project. Installed browser wallets are
discovered through EIP-6963 with a generic injected-provider fallback. Para v3
provides an optional embedded email/social wallet without loading its runtime
for anonymous visitors.

# Getting Started

1. Install the exact Node release in `.nvmrc`, then create local configuration:

   ```sh
   cp .env.example .env.local
   ```

   The local defaults use real Bendystraw mainnet and testnet data, Para beta,
   and `https://dev.juicebox.center` for RPC reads and IPFS writes. No provider
   credential or Center API key is required.

1. Install dependencies:

   ```
   npm ci
   ```

1. Run the app:

   ```
   npm run dev
   ```

   Revnet runs at <http://localhost:3002> by default.

See [TESTING.md](./TESTING.md) for the invariant suite, transaction coverage inventory, and CI gates.

Run `npm run build:browser` first, then `npm run test:browser`, for deterministic
production layout, keyboard, and accessibility checks at the supported viewport
widths. `test:browser` only stages and starts the existing build — the fixture
RPC and indexer origins are baked in at build time, so a plain `npm run build`
leaves the suite pointed at live networks and it fails wholesale.

`npm run check` is the release-equivalent local gate. See
[DEPLOYMENT.md](./DEPLOYMENT.md) for the standalone container, configuration,
GHCR release, health check, rollback, and IPFS pinning controls. The runtime
architecture decision is recorded in
[ADR 0001](./docs/architecture/0001-frontend-runtime.md).

## Resource

- Revnet v6 contracts: https://github.com/rev-net/revnet-core-v6
