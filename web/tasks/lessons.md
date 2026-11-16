
## 2026-10-06: Safe recovery follows intent, not signature serialization
- Correction: an extra owner confirmation changed exact bundle calldata keys and caused Retry checks to repeat a reservation warning.
- Rule: when resuming a saved quote, match complete identical Safe intent sets and keep its frozen original bytes. Preserve actual or ambiguous funding reservations across legacy records; quote-only replacement follows the corrected rule below.

## 2026-10-06: A Safe quote is not a funding attempt
- Correction: a quote-only historical selection still blocked the user's currently ready transactions even though they had never paid.
- Rule: distinguish quote creation from funding evidence in the shared Safe lifecycle; let the shared owner replace an eligible unfunded quote for the current reviewed selection, while preserving submitted, hashless, malformed and otherwise ambiguous funding history. Test the real four-saved/three-current user flow rather than only recovery messages.


## 2026-10-07: Display latency must not become an authority verdict
- Correction: Account showed Unknown on some chains and delayed pending multisig queues even when the same operator was a Safe elsewhere.
- Rule: share display identity probes, render independent chains as they finish, and expose retryable verification failures explicitly. Keep fresh action authority checks separate; never use a cached or failed display probe to authorize a write.

- Follow-up: after consent, say the quote is being requested; after payment, show each chain's submission and verification progress from shared lifecycle events. Never leave a paid flow presenting the Pay action or a stale wallet-confirmation message. A missing receipt is pending until proof is available, not proof of failure.
## 2026-10-07 — Make automatic phases visually distinct from actions

- User correction: per-chain Checking/Ready was buried in muted detail text, and preparation showed a disabled button despite advancing automatically.
- Rule: place concurrent status beside its chain heading, separate details below, and render one passive progress message while no action is available. Keep dismissal possible before payment; verify mobile wrapping and the quoted/paid states.


## 2026-10-07 — Keep payment actions concise
- Correction: the user wants the initial Safe bundle funding action and nested payment confirmation both labeled “Pay”.
- Rule: put the transaction count and execution explanation in the review content; keep the payment button label Pay. Preserve disabled, pending, recovery and authority behavior when changing labels. Existing Safe queue and payment-review assertions enforce the exact label.

## 2026-10-07 — Remove duplicate reads without removing final validation

- Correction: repeated checks delayed the final payment flow. Saved Safe preconditions and mandatory legacy guards caused identical nonce/hash reads within one validation pass.
- Rule: deduplicate only equivalent address/calldata/expected tuples inside the existing verifier invocation; retain conflicting expectations, synthesize missing legacy guards and reread on every later pass. Guard, raw-payment, direct-batch and Safe-payment regressions enforce exact per-pass counts and refusal after final state drift.

## 2026-10-07 — Describe the actual payment phase and verified effect

- Correction: final preparation retained Review payment copy, and a wrapped wallet payment left rows waiting for payment after submission.
- Rule: use the shared lifecycle's phase boundaries: Preparing payment covers consent and local preparation, Checking before payment covers final beforeSend guards, and submitted/ambiguous evidence says Checking payment status. Keep canonical wrapped-funding proof and per-chain verification in the SDK. Deferred actual-adapter and rendered progress regressions enforce the order without new app polling or weaker guards.

## 2026-10-07 — A package tarball does not include its installed nested dependencies

- Finding: replacing the entire installed SDK directory with a preview tarball also removed its nested bs58/base-x packages, causing fallback to different root major versions while every manifest hash stayed unchanged.
- Rule: retain nested node_modules when replacing only a package's own files, then verify the whole installed package-path/content graph and actual dependency resolution. Package metadata and compiled-file equality alone do not qualify the installation or bundle measurement. Invalidate measurements from an incorrect graph; require final clean-install CI before release.

## 2026-10-09 — Continue confirmation after a submitted payment
- User evidence: pending-payment batch funding showed confirmation uncertainty, but succeeded and registered when the existing action was clicked again.
- Rule: a temporary post-broadcast receipt/proof read failure must keep the existing canonical reconciliation observer running; preserve submitted-payment exclusion and show saved-batch continuation rather than a fresh confirmation. A submitted hash is not proof of failed execution.
- Gate: raw Relayr funding regression must recover from a transient proof-read failure with one wallet send; pending-routing regressions must resume the saved batch ID and wrap the complete hash/error.

## 2026-10-12 — Composite rankings display project chain membership
- User correction: Trending chain icons showed only the representative activity unit's chain.
- Rule: composite project rows use the indexed sucker group's member chains for their icons, deduplicated and supported; do not infer membership from a truncated ranking page or change rank/payment/volume values while fixing presentation. A rendered multi-chain regression enforces the distinction.

## 2026-10-24 — Price-based shop voting is an explicit policy
- User clarification: always compile new shop tiers with useVotingUnits=false, including legacy drafts containing custom votes.
- Rule: ignore legacy custom voting values in the owning compiler, describe price-based votes in the editor, and reject priced additions when an existing collection locks new voting power. Never flip true to bypass that lock.

## 2026-10-24 — Preserve module directives when adding imports
- Local verification caught an import inserted before a client module's directive.
- Rule: insert imports after existing directives, then run changed-file lint before an expensive artifact build. Prettier can turn a displaced directive into an ordinary expression, so formatting alone does not prove the client boundary survived.

## 2026-10-24 — Invoke within the acquisition continuation
- Astra reproduced an old provider invocation after a same-account connector switch inside wagmi acquisition; resolving through getWalletClient alone did not close that await race.
- Rule: acquire the explicit current connector, retry UID drift, run operation-scoped final guards and invoke in the same continuation. Test held real connector acquisition, distinguish pre-invocation cleanup from actual RPC uncertainty, and keep refusal text visible through the installed SDK's UI adapters.

## 2026-11-05 Same widget, same layout across clients
- When restyling a header tooltip or breakdown in one client, first open the equivalent in the other client and copy its layout. jango picked jbm's stacked per-chain layout (title line, chain icon and name, token amount over USD, divider, All chains) over a fresh column grid built in revnet. Diverging designs cost a second round; parity is the default, not a follow-up.

## 2026-11-06 — Cash out tax is a value, not a percentage
- Correction: a UX review proposed rendering the cash out tax as "10%" to match a chart. The tax is a 0 to 1 value and is never a percentage; any percentage is a derived output of the curve formula.
- Rule: render the tax as its 0 to 1 value everywhere, and when two surfaces disagree, check which one states the protocol's own unit before picking the fix.

## 2026-11-06 — Review proposals are hypotheses until checked three ways
- Correction: jango saw that some review fixes were wrong and asked for a triple check before changes. Two more of my claims then failed: a memo "no cap" answer rested on one contract grep, and a voting-units fix assumed a read flag that does not exist.
- Rule: before changing code from a review, confirm the symptom in the source, confirm the correct behavior from the authority (contract, live data, sibling client) with file and line, and prove the fix with a test or render. Search the concept across every repo on the path before saying a limit does not exist. An unconfirmed item is reported, not changed.
