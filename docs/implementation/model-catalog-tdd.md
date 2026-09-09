# Model catalog refresh

The initial fixed `MODEL_PRICES_JSON` observation expires within 24 hours. Production can instead set an explicit `MODEL_POLICY_JSON` allowlist containing the same token prices and input/output bounds, without an expiry. The operator-selected prices are conservative ceilings; automatic refresh never raises them or adds a model.

The gateway reads Venice's fixed public model endpoint once a minute. It enables only explicitly allowed, online, nonreasoning text models whose DIEM prices and context/output limits still fit the reviewed policy. Observations expire after five minutes. Provider removals, excessive prices, smaller bounds, and malformed identities disable affected models. Network failures cannot extend an observation. No account, key, paid inference, arbitrary upstream URL, or USD fallback is used for metadata discovery.

Seven test-first cases establish conservative ceiling retention, DIEM rather than USD pricing, expiry during outages, price/capability/bounds changes, removal, unreviewed models, decimal rounding, duplicate identities, response size, concurrent refresh, and invalid policies. The initial missing-module RED run was followed by all seven passing. Gateway requests take one immutable catalog snapshot before reserving budget.

The source shape was checked against the [official model API reference](https://docs.venice.ai/api-reference/endpoint/models/list) and a successful unauthenticated GET on September 9, 2026. This observation verifies only metadata access. It does not establish account activation or usable project credit.
