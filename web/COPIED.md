# Copied files

Files that come from Juicebox Money (jbm, `webclients/juicebox-money`). Each row names the source path, the source repo's commit when it was copied, and the edits revnet made. A fix to a copied wallet or transaction primitive lands in jbm, revnet-money and Homerun in the same change.

| File | Source | Source commit | Edits |
|---|---|---|---|
| `scripts/lib/test-titles.mjs` | jbm `scripts/lib/test-titles.mjs` | jbm 98c9409, unchanged since ca6e0eb (jbm#109) | None. Byte for byte: `git hash-object` gives jbm's blob id, `208f934`. `scripts/check-wallet-write-sites.mjs` reads a test file's markers through its `provingTitleWords`. |
| `test/lib/test-titles.test.ts` | jbm `test/lib/test-titles.test.ts` | jbm 98c9409, unchanged since ca6e0eb (jbm#109) | None. Byte for byte: blob id `9db6ece`. It tests the file above. |
| `TESTING.md`, the marker rule's paragraph under Transaction coverage inventory | jbm `TESTING.md` (the sentences of its `transaction:check` entry on the marker) | jbm 98c9409 | The words are jbm's except three things: `an action` is `a money-moving or project-control action`, since revnet's boundary actions need no marker; the marker is `wallet-action:` plus the action's id in `test/fixtures/wallet-write-sites.json` (`wallet-action:pay`), where jbm's is the action's name in lowercase with hyphens; and the count is `49 of the 69 marked titles`, where jbm's is `52 of the 92`. The count is measured as jbm measured its own: the marked titles that count under the rule and would not under a copy of it whose `setupMaySkip` also refuses every `new` and every call that is not a test, suite, hook, `vi`, `vitest` or `expect` call, outside nested functions. The same copy gives jbm's 52 of 92 over jbm's tests at 98c9409. |

Both copies keep jbm's formatting (no semicolons, single quotes), which revnet's Prettier config would change. `test/fixtures/format-debt.json` holds each file's SHA-256 as reviewed formatting debt, so a change to a copy fails `npm run format:ratchet` until its new digest is reviewed, and the two stay equal to jbm's.
