# Public wallet and RPC origin verification

Checked at 2026-09-09T22:39:31.158183+00:00 for exactly `Origin: https://telligence.money`.

- Installed Para web SDK: 3.15.0; production API: https://api.getpara.com.
- Existing production public browser key read from revnet-public.json; key not copied into this record.
- OPTIONS /touch?regenerate=false: HTTP 204; exact Access-Control-Allow-Origin https://telligence.money; credentials true; required SDK headers allowed.
- Anonymous POST /touch?regenerate=false: HTTP 200; partnerId and supported wallet types returned. No signup or wallet creation.
- GET /partners/[returned partnerId]: HTTP 200; exact Access-Control-Allow-Origin https://telligence.money; credentials true.
- Public application configuration identifies shared Juicebox app, EVM wallets; verification URL https://juicebox.center; homepage https://juicebox.money.
- Provider origin allowlist itself is not exposed in public response. Actual startup/config requests accept the target origin.
- OPTIONS https://juicebox.center/v1/rpc/8453: HTTP 204; Access-Control-Allow-Origin *; POST/content-type allowed.
- POST same RPC endpoint with eth_chainId: HTTP 200; JSON-RPC result 0x2105 (8453/Base); Access-Control-Allow-Origin *.

No existing application settings were mutated. No account signup, wallet creation, signing, transaction, payment, or IPFS write was attempted. Anonymous session response headers were not retained.

Official docs:
- https://docs.getpara.com/v2/general/production-deployment
- https://docs.getpara.com/v2/react/guides/customization/developer-portal-setup
