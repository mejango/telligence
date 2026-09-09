# Transaction boundary TDD

The frontend transaction tests were written before the Telligence transaction module. The first run failed to resolve that module. After adding the exact-unit VVV parser, deployment identity checks, and standard payment builder, four tests passed and the Base-only transport test failed against the inherited eight-chain configuration.

The transport was then restricted to Base, with an explicit runtime rejection for other chain IDs. The five transaction tests passed under Node 22.23.1 and Vitest 4.1.10.

These tests exercise invalid monetary input, substituted deployment configuration, stock buyback metadata, slippage bounds, and unsupported-chain rejection. They do not replace transaction simulation or the deployed factory registration checks used by the wallet components.
