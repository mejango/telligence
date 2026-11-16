# Parity with juicebox.money for revnet actions (2026-11-13)

jango: "make sure revnet money is also aligned with juicebox money, though be mindful it is scoped only to revnet projects."

- [x] R1 Cash out: sale deadline follows the Safe rule; a fresh minimum below the reviewed one refuses with "The cash out estimate dropped. Review the new estimate."
- [x] R2 Loans: a Safe proposal ends as proposed in Borrow, Reallocate and Repay, never as done.
- [x] R3 Buyback router card: Add to batch needs the danger acknowledgement, like Send.
- [x] R4 Loan fee total falls back to the SDK protocol constants when the onchain read is missing; repay check errors read plainly.
- [x] R5a Cash out ends on a confirmed state with a transaction link and stops under View as; the buyback card says when a registry read failed instead of "Not set".
- [x] R7 The shared `.jb` file, version 2 (rulings of 2026-11-14, needs SDK 6.8.0): `src/lib/jb-draft.ts` maps the SDK's `JbDraft` to and from the create form; a project file, or a revnet file holding what this form cannot express, is refused whole and by name. Import, export and the Extras export go through it; the browser's saved draft keeps the form's own shape. Shop item media pins when chosen and keeps its type. `/llms.txt`, the Build guide's Draft format link and `public/examples/revnet.jb` state the new format. No version 1 import.
- [x] R5b Holder flows (2026-11-14): liquidity shows a viewed account's positions with the actions locked; buyback and router address fields take an ENS name and the review freezes the address it showed; the cash out confirm names the fee already taken out and the loan confirm its fees and "You receive"; cash out amounts use the selected chain's token decimals and symbol. The cash out token comes from the chain's terminal (`pickAccountingContext`), held as loading until the terminal and the index answer, and an open review keeps the token it opened with. A burn proposed to a Safe is named as a proposal. Activity: a bridge send reads "sending X to Chain" and the cash out the sucker makes inside it makes no row, as juicebox.money.
- [ ] R5 Still open: the cash out terminal is still the canonical JBMultiTerminal, not read from the directory. For jango: one review for ERC-20 repay (the pre-send simulation cannot run without the allowance).
- [x] R7 Round two, after jango's rulings of 2026-11-13: the 404 names the path after hydration (the prebuilt page said "/_not-found" and raised React 418); the shop shows "+ Add items" and free mint to everyone and the modals refuse a wallet without the permission; tickers without a dollar sign; the credits line, Claim credits and its batch code are removed, because REVDeployer deploys the ERC-20 in the launch transaction and JBTokens mints ERC-20 whenever a token exists, so a revnet holder never has credits.
- [x] R8 SDK rules (needs SDK 6.6.0, PR Bananapus/juice-sdk-v4#307), as juicebox.money: ERC-20 pay asks a plain wallet for a free Permit2 signature after one approval of Permit2, and a Safe or contract wallet for the exact approval (`planErc20PayAuthorization`); the buyback card and the market resolve the hook and router terminal with `resolveProjectBuybackHook` and `resolveProjectRouterTerminal`; the revnet cash out fee uses the contract's rounding and skips when the fee revnet has no terminal for the token (`cashOutCountAfterRevnetFee`, `revnetCashOutFeeApplies`). Asked jango: whether the market floor shows the figure net of the revnet's fee.
- [x] R9 Safe pay as one batch, as juicebox.money: an ERC-20 payment from a Safe app goes as one proposal of the approval and the payment (core's `batch`), and its execution is the payment's success. A resumed run still proposes step by step.
- [x] R10 The market floor is one token's reclaim net of the revnet's own fee and the protocol fee (`readMarketReferencePrices`), the number the cash out review shows and juicebox.money's `useCashOutFloor` uses; it was the gross.
- [ ] R6 Not yet compared: pay card, read surface and home, operator metadata, splits and permissions, send modes and shell, launch form and guides.

## Plan refinement
- **Objective:** For a revnet, the same action on revnet.money and juicebox.money builds the same call and says the same words. Success is each listed gap closed with a test, or put to jango.
- **System fit:** juicebox.money through the SDK is the reference. revnet.money stays scoped to revnets; shared rules come from the SDK (`safe-service`, `loan-math`), dialogs only display them.
- **Reuse and simplicity:** Reuse SDK exports already in the lockfile; no new SDK release, no new helper where one exists (`swapDeadline`, `SAFE_PROPOSAL_PENDING_LINE`).
- **Evidence and unknowns:** Gaps come from three read-only comparison reports (subagent output), each re-read in code before a change. Open: whether revnet fee math (`applyRevFee`) should move into the SDK.
- **Verification:** One regression test per fix; full `npm run check` green; one browser test (`project-shape` alias tab, tablet) failed once under load and passed 15 of 15 on rerun.
- **Resource budget:** One worktree, one PR, edits in the main session. Replan if a fix needs an SDK release.
- **Authority and recovery:** Local commits and a PR only. Merge when jango says so. Each fix is its own commit and can be reverted alone.
- **Agent-system impact:** None.

## Holder flows (R5b, 2026-11-14)

## Plan refinement
- **Objective:** Close the R5 holder gaps that need no ruling: view-as liquidity, ENS in buyback and router fields, fee rows in the cash out and loan confirms.
- **System fit:** Reads follow `useViewedAccount`; writes stay behind `requireNoViewAs`. Fee numbers come from the SDK (`CashOutRoute.treasuryProtocolFee`, `netLoanProceeds`); the dialogs only display them.
- **Reuse and simplicity:** Reuse `useEnsAddress`, the existing confirm row lists and the SDK fee helpers. One new component, `EnsAddressInput`, because two fields share it.
- **Evidence and unknowns:** Gaps from the comparison reports, re-read in code. Codex pass 1 found a re-resolved name could rename the reviewed address (frozen at prepare); pass 2 found the Fee row used the page's token (now the selected chain's config, which is still the indexed one, not an onchain read).
- **Verification:** A regression test per change (`liquidity-account-binding`, `buyback-router-dialog`, `value-send-hold`); full `npm run check`; Codex until clean.
- **Resource budget:** One branch stacked on the `.jb` PR; all client JavaScript budget raised 2803 to 2804 KiB with the reason beside it.
- **Authority and recovery:** Draft PR only, merged on jango's word. Each change is its own commit.
- **Agent-system impact:** None.

## Review
Full `npm run check` green on c3b5b0f9: 332 files, 3189 tests, all budgets (all client JavaScript 2803.0 of 2804 KiB). Codex `gpt-6.1-sol` three passes: one finding, one finding, then CLEAN. Not rendered in a browser with a wallet. New copy for jango: "Looking up…", "Name not found", "Not a valid address", the "Fees" and "You receive" loan rows, the "Fee" cash out row, and the view-as note on liquidity.

## Holder flows, second part (R5c, 2026-11-14)

## Plan refinement
- **Objective:** Close the remaining holder and read gaps against juicebox.money that need no ruling: the cash out review's token, the Safe burn toast, bridge sends, loans and bridge claims in activity, and the pay review's beneficiary and payment notice.
- **System fit:** The cash out token comes from the chain's terminal through the SDK reader and one picker in `tokenUtils`. Activity rows are mapped once in `mapActivityEvents` and read by the project, account and homepage feeds. The payment notice is project metadata, snapshotted into the prepared payment the review already binds to.
- **Reuse and simplicity:** No new components. The notice rides the existing payment identity, so the existing "payment changed, review again" path covers a notice that arrives late. Loans and claims reuse the row sentence and category tables.
- **Evidence and unknowns:** Each gap re-read in both clients. Indexer fields checked against the live schema, including a bridge claim's 32-byte beneficiary. Unknown: whether jango wants the new wording; listed for him.
- **Verification:** A regression test per change; full `npm run check`; Codex until clean or only contrived findings remain.
- **Resource budget:** Same branch and draft PR (#134). Budgets raised only to the measured sizes, with reasons beside them.
- **Authority and recovery:** Draft PR only, merged on jango's word. Each change is its own commit.
- **Agent-system impact:** None.

## Review
- Cash out review: the reclaim token is read from the chain's terminal, the review waits for the index and the terminal read, and the token is frozen for an open review. A burn proposed to a Safe is named a proposal.
- Activity: bridge sends ("sending X to Chain", by the account that called the sucker, with the sucker's inner cash out dropped), loans, repayments, liquidations and bridge claims. A loan or claim is its transaction's row by the calling account, so a Safe's repayment is not attributed to its executor. The homepage describes a bridge send. Split distributions are labelled "Splits".
- Pay review: Beneficiary and Project notice rows. The notice is snapshotted when the payment is prepared, a change asks for review again, and Pay stays off while the controller or the metadata file is being read.
- Verification: `npm run check` gates green (333 files, 3202 tests, 160 browser tests, budgets). Codex `gpt-6.1-sol` passes 3 to 8 on this part: nine findings fixed. Set aside from pass 8 as contrived: peers whose metadata diverged after a half-finished update show the page chain's notice (juicebox.money does the same). A failed metadata read lets a payment proceed without the notice.
- Budgets raised to measured sizes: all client JavaScript 2805, `/[slug]` 601, owners 639, shop 607, extras 620, `/account/[id]` 433 KiB.
- New copy for jango: "Bridged out", "Bridge sends", "Bridged in", "Bridge claims", "Loan", "Loan repaid", "Loan liquidated", "Loans", "Loan repayments", "Liquidations", "Splits", "Beneficiary", "Project notice".

# Deliberate-backlog (D) items — revnet-money — 2026-07-28

Baseline: 66 files / 333 tests green (node 22).

- [x] 5. Small fixes: "Insuffient" typo; delete dead addresses.json; ShieldProject version: 6; getTopProjects survives ETH-price failure (keeps rows that need no price)
- [x] 3. Account subroutes: mainnet bendystraw pin centralized in ACCOUNT_BENDYSTRAW_CHAIN_ID (lib/accountHoldings.ts) — app has no testnet account mode today
- [x] 4. Owners caps: V6AllCard participants limit 1000 (PARTICIPANTS_FETCH_LIMIT) + totalCount + "aggregated from the N largest positions" caption; aggregation extracted to participantsAggregate.ts
- [x] 1a. getTokenConfigForChain returns null when unknown; RepayDialog/useBorrowDialog/LoansDetailsTable/RedeemDialog/V6YouCard/V6AllCard treat null as LOADING
- [x] 1b. RepayDialog native repay sends ceiling loanData.amount unconditionally (excess refunds)
- [x] 1c. Symbol gates replaced with isNativeToken (native-sentinel address) checks
- [x] 6. Timer-driven closes/error-clears removed (RepayDialog success -> explicit Close; useBorrowDialog terminal states persist); V6TokenPanel/PayerDeployForm timers converted to immediate + unmount-safe catch-up refetch
- [x] 7. SelectedLoan interface (useBorrowDialog + ReallocateDialog + V6LoansSubtab); melon-25/melon-300 panels + zinc text in Borrow/Redeem/Repay dialogs
- [x] 2. SuckerExtensionCard in Operator tab: REVDeployer.deploySuckersFor per chain, config-hash verification, accounting-context-derived asset mappings, shared salt, simulate-first sequential writes
- [x] Verify: 69 files / 350 tests green; tsc clean; eslint clean; wallet-writes:check 76 sites

## Review

All 7 backlog items landed without touching unrelated code. Contract facts for item 2
were verified against revnet-core-v6/src/REVDeployer.sol:631-656,900-921: operator-only
(`_checkIfIsOperatorOf`), ruleset metadata bit 2 gate, sucker salt =
keccak(hashedEncodedConfigurationOf, userSalt, caller) — so the client verifies the
target chain's stored config hash matches before building writes, and documents that a
missing/mismatched hash requires a prior byte-identical deployFor (unreconstructable
from chain state — only the hash is stored). New tests: token-config (5),
sucker-extension (6), owners-participants (3), account endpoint pin (1), top-projects
price-failure (1), ShieldProject version pin (in bendystraw-operations).

## Published SDK switch (2026-10-05)

- [x] Inspect the PR branch and existing CI failure in an isolated checkout.
- [x] Pin core 2.19.0 and remove preview archive, provenance and Docker/docs references.
- [x] Regenerate the lockfile and verify dependency integrity.
- [x] Run CI-equivalent checks and assess the inherited production advisory.
- [x] Review the SDK-only dependency diff and prepare the existing PR update.

### Published SDK switch review

Pinned the npm release with a four-line lockfile replacement and removed the preview archive/provenance and Docker/docs references. No other dependency versions or application source changed. All 721 distributed SDK files match the reviewed preview byte-for-byte.

`npm run check` passed: dependency, dead-code, environment, deployment, type, lint, formatting, source, wallet-write, coverage (1,824 tests passed, one skipped), production build, standalone, bundle and browser checks (121 passed, four skipped). All-client JavaScript is 2,626.8 KiB, within the unchanged 2,627 KiB cap. Independently verified 44 contract artifacts at pinned commit a6ab40c5806b52ff4cb21f9eaefe275e621796f9. Local verification used available Node 26.7.0 with pinned npm 12.0.1; CI retains Node 26.5.0.

The separate production audit still fails on inherited node-forge GHSA-86w9-cpqp-85rv and its Para dependency chain. As of 2026-10-05, npm latest is affected 1.4.0 and GitHub lists no patched version. The audit gate remains unchanged.

## Production audit advisories (2026-10-05)

- [x] Read how Para 3.15.0 uses node-forge. Seven files generate and restore an RSA key pair, unwrap shares with RSA-OAEP, convert keys to and from PEM, and use AES-CBC, SHA-256 and random bytes. No Para code verifies a signature, so GHSA-86w9-cpqp-85rv's code path is never reached.
- [x] Allow GHSA-86w9-cpqp-85rv by advisory id at high severity, only while the source check of Para's node-forge usage matches that audit (jango, 2026-10-05: Para's audit findings don't block merges until Signa replaces Para).
- [x] Move source-map-js to 1.2.2 for GHSA-68fv-2mgg-jv7q with a lockfile-only update; postcss already accepts ^1.2.1.
- [x] Prove an unknown advisory still fails: unit cases, and the live audit on the old lockfile, which names only source-map-js.

### Production audit advisories review

Para's own JavaScript is identical in jbm and revnet, so one audit covers both. The new gate failed live on the old lockfile and named only source-map-js, then passed on 1.2.2.

`npm run check` passed with Node 26.7.0 / npm 12.0.1: dependency, dead-code, environment, deployment, type, lint, formatting, source, protocol (fixture mode), wallet-write (140 call sites), coverage (1,840 tests passed, one skipped), browser build, standalone, bundle (2,627.0 of 2,628 KiB) and browser checks (121 passed, four skipped, inside the shared gate lock). The first coverage run timed out one persist-scope test at 10 s while two browser suites ran; the file passed alone (107 tests) and the full rerun passed. `next build --webpack` passed last.

## The SDK's Safe checks, with the Safe creation proof (2026-10-05, W1-R1)

Spec: sticky-next-port/.superpowers/sdd/2026-09-29-sticky-next-port/safe-adoption-spec.md.

- [x] Authority identity and cross-chain trust from `@bananapus/nana-sdk-core/safe`; the handle authority reads the
      Safe's creation record from the project chain's Safe service (client and server); R90 line for an unproven Safe.
- [x] Same-address Safe deployment from the SDK (`prepareSafeSameAddressDeployment`).
- [x] Safe transactions and the service from `@bananapus/nana-sdk-core/safe-service`: queue card and tray guarded
      by `hasSafeService`, current owners for confirmations, refund transactions refused (R93), execution confirmed
      only by `safeExecutionResult` for the reviewed hash (EOA executions and Safe connector replies).
- [x] Distribution receipts from `@bananapus/nana-sdk-core/v6` (payouts and reserved tokens with their splits).
- [x] Tests ported to the call sites; spec tests added; gate; budget. The controller pushes and opens the PR.

### Review

The local copies are gone: `cross-chain-authority.ts`, `safeDeployment.ts`, `safe-queue.ts`, `safeOwners.ts`,
`payout-receipts.ts` and the MultiSend codec. What stays in revnet is wiring: `handle-authority.ts` (the creation
record for the handle authority, the R90 line) and `safe-transactions.ts` (the proposal origin, the R93 and
no-service lines, and `confirmSafeExecution`). Kept stricter than the SDK: no refund in the reviewed execution's
event, a JSON number nonce in an obsolete proposal's record, and the rejected recipient events of any project.

Gate: dependencies, dead code, environment, deployment, types, lint, formatting ratchet, source, protocol and
wallet-write checks pass; unit and coverage 1,811 passed, one skipped; browser build, standalone and browser checks
(121 passed, four skipped); the production build passes last. All client JavaScript measures 2,640.0 KiB, so its
budget rises from 2,627 to 2,641 KiB (the SDK's checks are larger than the copies); route budgets are unchanged.

### Fix round 1

- [x] The route server reads the Safe service once, within 4 seconds, and refuses a 429; creation records are cached
      per chain and Safe (24 hours when they prove the Safe's address, 60 seconds otherwise), in the page too.
- [x] The canonical handle counts only when its own route resolves it to the project.
- [x] A Safe proposal settles only when what executed, or what the service records, runs the reviewed calls; the
      approval count uses the current owners and the live threshold.
- [x] A reverted execution or an ExecutionFailure settles failed and may be sent again.
- [x] The Ethereum handles row of an unproven Safe shows the R90 line; the refund refusal is tested in each action.
- [x] The source scans parse once (persisted queries) or get a 60 second timeout (ERC-20 approve).

Gate on the final commit: the same checks pass; unit and coverage 1,833 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,641.3 KiB, so its budget
rises by 1 KiB to 2,642 KiB. Left closed: the SDK's `multiSendCallsOf` knows MultiSendCallOnly 1.3.0 only, so a
1.4.1 Safe's batch stays unconfirmed.

### Fix round 2

- [x] A Safe proposal whose result can't be confirmed (a 1.4.1 batch, a relayed execution, another call) ends its
      watch in a marked state that reloads leave alone; it still refuses the identical call until its account
      dismisses it from the account's activity. Proposals journaled before the reviewed calls keep the earlier rule.
- [x] A reverted execution's line says only that this execution ran nothing; an ExecutionFailure says the call failed.
- [x] Checks of one Safe that start together share one creation record request.

Gate on the final commit: the same checks pass; unit and coverage 1,839 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,641.5 KiB, within 2,642 KiB.
SDK 2.20.0 teaches `multiSendCallsOf` MultiSendCallOnly 1.4.1; a follow-up takes it.

### Fix round 3

- [x] An unconfirmed proposal's card, and its Dismiss, stay in the account's activity once its hash is indexed.
- [x] Every proposal the app can't follow ends unconfirmed: a chain without a service after a minute; a proposal the
      service never lists, a record it can't authenticate, one reported executed without its transaction, one whose
      nonce another transaction took, or a receipt that never comes, when the watch gives up or an hour after the
      proposal was made. A proposal awaiting approvals, or behind an outage, is followed on the next load.
- [x] An identical call refused by an unconfirmed proposal says to check it in Safe and dismiss it.
- [x] The reload filter is the only guard against watching a marked entry again, and its test fails without it.
- [x] Every creation record read, the page's too, is one 4 second try with a 429 refused.

Gate on the final commit: the same checks pass; unit and coverage 1,849 passed, one skipped; browser checks 121
passed, four skipped; the production build passes. All client JavaScript measures 2,641.9 KiB; the budget rose by
1 KiB to 2,643 KiB when a build measured 2,642.0 KiB at the old budget.

### Fix round 4

- [x] No Safe proposal ends unconfirmed on one look. With a service, it ends at the first look an hour after it was
      made once 120 looks in a row (ten minutes) could not follow it. Not listed, a record it can't authenticate and
      executed without its transaction count from the watch's first look, so such a proposal ends an hour after it
      was made, or ten minutes into its watch if that is later; the nonce is read only after the hour, so a nonce the
      Safe moved past ends it ten minutes after the hour at the earliest, and the service's report of its own
      execution settles it meanwhile. Without a service, every chain check of the minute must find no transaction;
      a check the node can't answer leaves it live.
- [x] A missing execution receipt's hour counts from when the execution was first seen, not from the proposal.
- [x] The Safe's nonce is read at most once a minute, through the reader the owners and threshold use.
- [x] A refusal by an unconfirmed proposal, a dependent step's too, says to check it in Safe and dismiss it, and every
      flow shows it as an error; the loan permission toast says why the grant failed.
- [x] The no-service, no-client rule and the single call's unconfirmed refusal have tests that fail without them.

Gate on the final commit: the same checks pass; unit and coverage 1,860 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,642.2 KiB, within 2,643 KiB.

### Fix round 5

- [x] A look that learns nothing (the service down, the nonce unreadable, a chain check the node can't answer)
      neither counts toward ending a proposal nor starts the count over; only a look that shows it live (listed
      unexecuted with its nonce still to come) does. Without a service, the watch keeps checking the chain once a
      minute after its first minute, up to the hour, and twelve checks that find nothing end the proposal.
- [x] The chain is checked on every look of the watch's first minute and then once a minute, and once more before
      the watch ends a proposal on its looks, so an execution sent at once that a node shows late settles.
- [x] The loan dialogs (the permission step, the loan, refinancing and repayment) give a step refused by an
      unconfirmed proposal the title "Safe proposal unconfirmed" and a status line that says to check it in Safe
      and dismiss it, never a denial or a failure.
- [x] The once-a-minute reader says why it keeps one read.

Gate on the final commit: the same checks pass; unit and coverage 1,869 passed, one skipped; the production build
passes last. All client JavaScript measures 2,642.6 KiB, within 2,643 KiB. Browser checks: 120 passed, four skipped,
and one viewport of the handle route test failed with React's "Connection closed" (#412) under a load average of
about 47; rerun alone, two other viewports failed the same way, and rerun alone with one worker, all five passed.

### Fix round 6

- [x] A Safe proposal ends unconfirmed only on the chain's answer: this look's own chain check, or one more, must
      say no execution of the reviewed calls is there. While the node can't answer, the end waits for the next
      once-a-minute chain check, and a watch that gives up while waiting leaves it for the next load. Without a
      service, the twelfth check's own answer ends it, with no other call.
- [x] A service outage and an unreadable nonce are tested not to count toward an end, and a 2xx service page that
      isn't JSON learns nothing too.
- [x] A proposal the service reports executed without its transaction ends with that report in its line.
- [x] The receipt hook reports a proposal whose result can't be confirmed as neither loading nor settled; the loan,
      repayment and pay flows left open over their own such proposal show its line instead of pending.
- [x] A refinance whose permission read fails ends in the error state instead of holding its dialog.

Gate on the final commit: the same checks pass; unit and coverage 1,880 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,643.0 KiB, under 0.05 KiB
from the 2,643 KiB budget, which rises by the minimum 1 KiB to 2,644 KiB.

### Fix round 7

- [x] Only the chain's answer counts toward a missing execution receipt's hour: a read that finds no receipt, or a
      receipt of another transaction, which never settles the proposal. A node that can't answer leaves it held,
      and an end of an execution the service reported keeps "Safe reports this proposal as executed".
- [x] The bridge, cash out, burn, liquidity removal and split recipient flows show the unconfirmed line over their
      own such proposal; the identical call stays refused until it is dismissed.
- [x] A test pins that the pay card holds the payment while its own proposal is pending.

Gate on the final commit: the same checks pass; unit and coverage 1,891 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,643.3 KiB, within 2,644 KiB.

### Rebased onto main (2026-10-06)

- [x] Rebased onto origin/main after #65 (Check deployment in Extras) and #66 (production audit advisories); the
      task notes and the client budget comments keep both sides. The budget rises from main's 2,628 KiB to 2,644 KiB.

Gate on the rebased branch: dependencies installed with npm 12.0.1 from main's lockfile; the same checks pass,
including #66's Para source checks; unit and coverage 1,907 passed, one skipped; browser checks 121 passed, four
skipped; `next build --webpack` passes last. All client JavaScript measures 2,643.4 KiB, within 2,644 KiB.

## Relayr sessions decided from the chain, through the SDK rules (2026-10-06, W2-RVR)

Reference: jbm 98c9409d src/lib/relayr.ts (executeRelayrCalls, savedRequestsVerdict, liveSessionVerdict,
holdUnprovenSession, discardableSession, relayrHeldMessage, RelayrDiscardError, revertedRelayrQuote),
src/lib/forwarder-authorization.ts, src/lib/launch-relayr.ts. Rulings R104, R114 (a-f), R117, R118.

- [x] Take SDK 2.22.0 (lockfile: only the package's version, resolved and integrity).
- [x] Tests first, red on the current code: a device-clock release never signs at the live nonce; a request that
      ran gives the "ran" Discard and no signature; every request dead and unused runs the recheck and signs again
      at the saved nonces; an unreachable recheck holds; a sped-up payment proves.
- [x] The SDK's payment details and payment proof replace paymentDetails and verifyPaymentReceipt; a payment proves
      on the hash it was mined under.
- [x] Each session saves the nonce each request was signed with. Its action classifies it (relayrSignedRequests,
      relayrRequestStates, relayrRequestsVerdict) before its recheck, and relayrSessionOutcome decides: reuse or
      re-quote the saved signatures, hold, sign again at the saved nonces, or Discard. No device clock releases a
      session; another session reserves a forwarder nonce, a call or a recovery scope while a request is live.
- [x] A replacement in the same recovery scope (the stale-start launch rebuild) signs at the replaced session's
      saved nonces, so only one of them can run.
- [x] A quote whose payment reverted is released only as jbm does (R104): payments proven reverted, deadlines passed
      at a canonical block, and Relayr read unpaid right before; Relayr reporting it funded holds it and proves what
      ran. A declined retry of such a quote stays on the retry rule.
- [x] A paid bundle that can't be proven holds while a request is live and is marked for Discard once all are dead.
- [x] The account view checks an unpaid session's signatures and offers Discard for a session marked for it.
- [x] Gate: lint, typecheck, wallet-writes:check, knip, test:ci, browser suite, build:browser.

### Relayr session rules review

Every session decision goes through the SDK: relayrSignedRequests, relayrRequestStates and relayrRequestsVerdict
classify a session at a canonical finalized block before its action's recheck, relayrSessionOutcome decides, and
relayrRequestsDead decides whether a session that shares only a forwarder nonce still reserves it. Nothing is
released by the device clock, and a new signature for saved calls goes only to a saved nonce. 29 behavior tests failed
on the code before these commits (the five the brief names among them) and pass after them; 5 more changed only in
shape, since the scope check is async and the relayed launch passes its chains to it.

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites), format ratchet and source checks pass;
unit and coverage 2,094 passed, one skipped; build:browser, standalone and bundle checks pass; browser checks 126
passed, four skipped, inside the shared gate lock. All client JavaScript measures 2,644.2 KiB against 2,641.7 KiB for
origin/main's sources on the same SDK; the aggregate budget rises by the minimum 1 KiB to 2,645 KiB.

### Relayr session rules fix round 1 (ruling R114 (g))

- [x] Different calls never sign at an old session's nonces while one of its requests can run: no refresh by
      recovery scope, no `replaces`, no device clock. A live session holds another action, saying until when.
- [x] The stale-start launch rebuild and a resubmitted launch wait until every request of the earlier launch is dead
      at a finalized block, then build and sign the new one (jbm's abandonable rule).
- [x] A raw or Safe quote is released only after Relayr reads it unpaid (jbm payer-relayr.ts:457-463).
- [x] A "ran" Discard abandons a pending batch by its round's scope as well as its bundle.
- [x] A paid bundle Relayr leaves pending is classified once every request is dead; completion clears a Discard mark,
      and a completed card offers no Discard.

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites) and the format ratchet pass; unit and
coverage 2,106 passed, one skipped; build:browser, standalone and bundle checks pass (2,644.1 of 2,645 KiB);
browser checks 126 passed, four skipped, inside the shared gate lock. 20 tests failed on the code before the round.

### Relayr session rules fix round 2

- [x] A replaced session keeps no Discard mark, and a replaced quote's card offers no Discard.
- [x] A Discard matches a batch round by the session's bundle, and by recovery scope only when Relayr named no bundle.

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites) and the format ratchet pass; unit and
coverage 2,109 passed, one skipped; build:browser, standalone and bundle checks pass (2,644.1 of 2,645 KiB); browser
checks 126 passed, four skipped, inside the shared gate lock. 3 tests failed on the code before the round.

## The SDK's reverted-quote rules (2026-10-06, W3-REL2-RVN)

Reference: SDK 2.23.0 `review/relayr` ("Quotes whose payment reverted"), jbm 27c40e98 src/lib/relayr.ts
(requireRelayrRetry, relayrRetryOption, proveSavedRelayrPayment, relayrPaymentAttemptOutcome, revertedRelayrQuote).
Ruling R104; R89 (nothing loosens silently).

- [x] Take SDK 2.23.0 (lockfile: only the package's version, resolved and integrity).
- [x] `sentPayments` moves beside `relayrSessionRequests` in src/lib/relayr-activity.ts (no behavior change).
- [x] revertedRelayrQuote, quoteUnfundable, quotedOptions, deadlinesPassed, requirePaymentRetry, the declined
      payment's catch and provePayment's proof are the SDK's. A saved payment `{ hash, chainId, target, data, value }`
      is read into the SDK's `RelayrSentPayment` once, in `relayrSavedQuote`; its deadline is the calldata's
      deadline word.
- [x] provePayment keeps revnet's outcomes over `proveSavedRelayrPayment` (which resolves false where it threw):
      no recorded payment is a manual verification, an unprovable one throws so the poll keeps checking, a revert
      marks the quote reverted.
- [x] A quote paid sixteen times is never paid again (the SDK's journal limit; revnet had none).

### Review

Behavior changes, each pinned by a test that failed on the code before: a quote is payable by its latest payment's own
deadline (jbm's rule) instead of the quoted option it matches, so a quote that no longer lists the paid option is
released once its deadlines pass at a finalized block, and held with "cannot be paid again from its saved record"
while payable; a bundle read that reports a payment without listing calls is not funded (the retry check still
refuses it); a wallet rejection is read as the SDK reads one (viem's name counts, eight causes deep at most); a saved
payment is read strictly (decimal amount, strict address); a missing RPC for a sent payment's chain refuses the retry
with the SDK's line. The SDK changeset's other differences cannot arise: revnet's payments are saved from the SDK's
own authenticated details, its bundle IDs come from a bound quote, and the deadline is derived from the calldata.

SDK gaps, kept local until it exports them: `relayrBundleFunded` (the poll of a quote whose own payment reverted
reads the bundle it just fetched) and the release of an unpaid raw or Safe quote at finalized blocks (the SDK's
`revertedRelayrQuote` needs a sent payment).

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites), format ratchet, source and deployment
checks pass; unit and coverage 2,128 passed, one skipped; build:browser, standalone and bundle checks pass; browser
checks 126 passed, four skipped, inside the shared gate lock. All client JavaScript measures 2,645.0 KiB against
2,644.2 KiB for origin/main's sources on SDK 2.22.0 (2 bytes over the old 2,645 KiB budget); the aggregate budget
rises by the minimum 1 KiB to 2,646 KiB. 15 tests failed on the code before these commits.

## 2026-10-06 — Pretty queued Safe confirmations

- [x] Extract the existing canonical protocol decoder without changing queue labels.
- [x] Reuse decoded queued calldata for nested review cards in single execution, Relayr execution, and queued signing.
- [x] Verify known actions, unknown/malformed fallback, and confirmation rendering; run focused tests and typecheck.

Review: 135 focused tests pass, including four-chain queued calldata and rendered consent/order regressions. Typecheck, changed-source lint, and wallet boundary checks pass. Cleared a stale generated Next route type after route-type regeneration. Independent review found no substantive issue. Changes are local; not deployed.

## 2026-10-06 — Paced Safe checks, final verification

- [x] Overlap independent checks with a two-worker limit in queue preparation, Safe Relayr quoting, and payment rechecks.
- [x] Preserve request order, sequential wallet signatures, and failure gating; drain pending checks before retry.
- [x] Test concurrency limit, overlap, stable ordering, and payment blocking.

Final review: 1,567 tests passed in the full run; three live-schema tests initially failed due sandbox DNS, then all three passed in narrowly approved network reruns after inspecting their read-only payloads. One pre-existing test remains skipped. Typecheck, changed-file ESLint and wallet boundary checks pass. Both clients now have readable queued confirmations and paced overlapping checks. No deployment performed.

Rebase verification: integrated origin/main c668b8ed and SDK 2.23.0, keeping SDK-owned canonical MultiSend decoding and the newer Relayr recovery checks. Readable actions now live in the shared TransactionReviewDialog. 2,138 local tests passed; three loopback RPC tests blocked by sandbox permissions passed on a permitted rerun. Typecheck, changed-file ESLint, and wallet boundary checks pass. Confirmed queued signing retains its readable metadata after conflict resolution.

## 2026-10-06 — Pending routing belongs to the destination

- [x] Query and validate retained payments by destination project, preserving source metadata in retry calldata.
- [x] Cover source 6 → destination 1, unrelated destinations, and multi-source incoming payments.
- [x] Verify reader/component/operation tests, typecheck, and matching JBM correction.
      Plan review: correct the existing query owner and boundary validation; no contract behavior change.

Destination-routing review: 30 reader/component/operation tests passed; typecheck, changed-file ESLint, fixture syntax and diff checks pass. Query and validation use destination projectId; sourceProjectId remains unchanged in commitments and calldata. Query cache key distinguishes destination-scoped results. Browser fixture now uses source 6 / destination 1; browser scenario updated, not run.

## 2026-10-06 — One Relayr bundle for pending payments

- [x] Preserve permissionless gateway retries as independent raw entries; allow repeated destination chains only for authenticated pending-routing calls.
- [x] Quote and fund all eligible retries in one bundle, binding records by quote transaction ID rather than chain.
- [x] Keep per-payment custody/receipt checks, pre-funding revalidation, and saved-bundle recovery; preserve forwarder nonce rules and Safe fallback.
- [x] Update both clients' batch review and test same-chain bundles, cooldown exclusion, exact mapping, failures and resume.
      Plan review: use the existing raw Relayr lifecycle. Each payment remains its own destination transaction; no atomic multicall wrapper. Existing local simulation bounds remain; Relayr chooses the actual execution gas.

- [x] Discover legacy saved routing attempts by their authenticated destination, preserving original scope, transport, hashes and resume state. Recover all-handled journals interrupted before completion.

Review: 2,152 local tests passed and one skipped (live schema and loopback RPC suites excluded for the sandbox); final focused verification passed 74 tests after the saved-recovery correction. Typecheck, changed-file ESLint, wallet boundary checks, format ratchet and diff checks pass. JBM reports 2,542 tests passing plus typecheck, lint and source/inventory checks. Same-chain raw entries share one funding payment and retain per-call receipt mapping, including canonical reverted attempts. Saved source-6 attempts now appear on destination 1 without rewriting recovery records. Changes are local, not pushed.

## 2026-10-06 — Distinguish pending inventory from saved routing selection

- [x] Split discovery from paced verification so indexed rows show immediately with a checking state.
- [x] Label the resume button plainly and separate saved progress from the pending total.
- [x] Preserve submission gates and resolved-row filtering; cover delayed seven-payment inventory plus three saved calls and per-row RPC errors.
      Review: 27 relevant tests pass; typecheck, changed-file ESLint and diff check pass. Both query stages share an invalidation prefix and use new cache keys for their new shapes. Follow-up remains local, not pushed.

## 2026-10-06 — Replace untouched routing drafts

- [x] Distinguish untouched drafts from submitted, funded, published, ambiguous or handled attempts.
- [x] Review the full current selection and replace the exact draft under the account lock after reservation checks and an atomic journal comparison.
- [x] Freeze reviewed identities, preserve recovery on failure, and require a fresh review after replacement errors.
      Review: 63 engine tests and 14 routing component tests pass; reviewed Relayr suite passed during engine validation. Typecheck and changed-file lint pass. Regression coverage includes late submission evidence, lost publication responses, cancellation, changed journals, and failed replacement retries. Changes remain local, not pushed.

## 2026-10-06 — Read-only routing recovery checks

- [x] Return saved calls and a specific state-based reason in recovery metadata; decode exact authenticated calls for the confirmation.
- [x] Recheck once per saved selection and on request without signing/paying; reuse reservation proofs and reset only unpaid expired quoted rounds under account lock and journal comparison.
- [x] Preserve unknown submissions/funding/missing evidence and freeze open review identity across checks.
      Review: 200 engine/Relayr tests pass; 17 UI tests and 15 pending-call tests pass, with typecheck, changed-file lint and diff checks. A screenshot cannot identify the local journal state; the UI now reports its real reason instead of generic zero-handled copy. Changes are local, not pushed.

## 2026-10-06 — Prepare Safe execution on open and pace RPC egress

- [x] Extract preparation without behavior change (19 baseline tests), then start it when Execute all opens.
- [x] Keep explicit quote review and separate payment confirmation; show payment chain options and decoded actions.
- [x] Pace browser RPC starts by 125ms across chains/retries without waiting for responses; all independent checks overlap and drain before error/payment.
- [x] Test cancellation, delayed quote, account changes, retries, error ordering, queued abort and 429 cooldown.
      Review: 23 Safe dialog/card tests pass and 145 transport/check/Relayr tests pass. Broad sandbox-safe suite: 2,195 tests passed plus one skipped; sole failure was the stale copy-debt record from removing the pending-call middot, corrected and its six tests now pass. Live schema and loopback RPC files excluded. Typecheck, changed-file ESLint, format ratchet and wallet-boundary inventory pass; quote owner inventory updated from executeAll to prepareAll. JBM full suite: 2,576 tests pass. Not pushed.

## 2026-10-06 — Resume saved Safe quotes instead of retrying creation

- [x] Match complete chain/Safe/hash/nonce intent sets while keeping the original quote, UUIDs and signature calldata.
- [x] Revalidate original calls and show their nested decoded review; preserve all historical alias keys.
- [x] Protect legacy and current same-nonce reservations against changed signature/subset/alternative-hash attempts.
- [x] Offer structured existing-bundle checks for incompatible/paid/ambiguous records instead of Retry checks.
      Review: 140 hook tests pass, plus 79 UI/activity/release/routing tests. Types and focused ESLint pass; wallet-boundary inventory remains unchanged. Existing quote recovery makes no new publication or payment. JBM has no equivalent persisted-unpaid-quote lookup deadlock. Local, not pushed.

## 2026-10-06 — Replace unfunded Safe quotes for the current selection

- [x] Trace the current Safe prepare path and storage adapter; coordinate the replacement rule with the shared SDK owner.
- [x] Consume the SDK's quote-only replacement result without implementing another app policy; retain actual or ambiguous funding evidence.
- [x] Cover four saved calls to three currently ready calls, lost quote response without funding, and funded/unknown recovery using the real hook and storage adapter.
- [x] Run focused tests, typecheck, lint and relevant source/wallet checks; record the verified result.

Review: both saved-quote and lost-response four-to-three flows review the current calls, post a fresh bundle, and fund once. Archived quotes cannot be funded; canceled review preserves the old record. Legacy remote execution observations and funding flags remain sticky across reloads. Final focused suites pass 205 tests; the full run plus bounded reruns verifies 2,266 tests with one existing skip. The reruns covered six sandbox-blocked network/loopback tests and the final copy change. Types, touched-file lint, source invariants, wallet inventory and diff checks pass. Release and dependency publication are tracked by the parent task.

Published-install verification: SDK 2.24.2 and the reified lockfile installation were tested on Node 26.7.0. The full suite passed 2,265 tests with one existing skip; its only failure was a stale generic-message assertion, replaced with the shared funding-unresolved result, sticky observed-funding flag and refusal to quote again. The final 205-test focused rerun passes, giving 2,266 verified tests and one skip. Full typecheck, lint, source guards and the 142-site wallet inventory pass. No production code changed during this final verification.

## Plan refinement

- **Objective:** Opening Execute all should review and quote the currently ready Safe selection even when an earlier quote-only record exists; actual or ambiguous funding must still recover without paying twice.
- **System fit:** SafeQueueCard collects live ready transactions, the reviewed hook delegates lifecycle decisions to the SDK, and the RNM adapter preserves journal evidence; the shared SDK remains the owner of replacement and funding gates, while explicit review and payment authority stay unchanged.
- **Reuse and simplicity:** Reuse the existing SDK prepare path and storage adapter; add only necessary release-copy integration and regression coverage, without another discard action or app-side replacement heuristic.
- **Evidence and unknowns:** The user's three-current/four-saved screenshot proves that the historical selection still blocks progress after 2.24.1; the agreed SDK contract replaces overlapping quote-only sessions after current-call review, retains them as quote-replaced, and protects fundingObserved or remote execution evidence. RNM will normalize legacy chainStates into shared records rather than classify statuses itself.
- **Verification:** Exercise actual prepare/storage/reload for four-to-three replacement and missing quote responses, assert current exact calls are reviewed/posted before any wallet payment and funded once only after explicit consent, and retain malformed, submitted and hashless-funding refusal regressions.
- **Resource budget:** Investigate RNM while the SDK policy is resolved in parallel; make the smallest adapter change, then run focused tests/types/lint against the preview. Repeat the full suite and static gates on the published 2.24.2 installation because npm reified dependency entries beyond the SDK archive; bound any subsequent rerun to a concrete failure.

## 2026-10-07 — Load operator accounts and Safe queues independently

- [x] Share display-only Safe identity queries per chain/address; retain fresh action checks.
- [x] Show per-chain discovery/account/queue progress and overlap independent queue reads.
- [x] Surface transient verification failures with per-chain retry, withholding actions until verified.
- [x] Verify deduplication, slow-chain independence, retry recovery and unchanged action safety.
- [x] Display shared quote/payment/execution phases, preserve each verified chain on recovery, and move the fee control to the footer.
- [x] Require successful bounded neutral-caller Safe simulation before quoting and payment.

Plan refinement (approved by parent): Account and queue already mount independently, but each repeats the full SDK identity proof and aggregate promises hide faster chains. Reuse React Query as the display read owner and retain bounded SDK proofs. Preserve the existing complete operator map for write consumers while exposing a partial discovery map only to Account/Queue. Begin read-only service discovery after the bounded nonce while identity and live authority checks run; expose transactions only after every proof completes. No SDK or RPC pacing changes. Test deferred and failed reads with real query caching; run focused component tests, types, lint and source/wallet gates.

Follow-up scope from the user: consume the SDK's quoting phase after the actual Safe review acceptance so the modal says “Requesting Relayr quote…” while Relayr responds; move the network-fee selector after the execution list into the confirmation footer. Reuse the shared lifecycle and dialog footer; leave quote/payment policy unchanged. Regress delayed quote, cancellation and the fee control's final placement.

Further same-flow corrections: consume shared SDK lifecycle progress for quote phases, per-chain hashes and receipt verification; paid or ambiguous failures return to read-only Check status. Keep verified execution distinct from a Relayr success report. Align RNM preflight with JBM by using the SDK's bounded neutral-caller simulation and requiring execTransaction=true; test false/malformed results before quote and before payment. These fixes keep state ownership in the SDK and do not retry payment implicitly.

Review: against the final frozen SDK distribution, the full suite passes 2,282 tests with one existing skip. Two subsequent review regressions cover repeated recovery subscribers and failed identity refreshes; the final 272-test focused rerun passes, giving 2,284 verified tests. Typecheck, touched-file ESLint, source invariants, source-only dependency audit, unchanged 142-site wallet inventory and diff checks pass. The actual SDK/hook test proves one chain can remain Confirming while another is Executed, closing/reopening recovery retains both states, delayed receipt proof completes on watch, and the wallet sends once. The display-query test proves cached successful identity is hidden after failed refresh and retry restores it. SDK controller reuse retains verified progress through fund/watch; display-only snapshots replay for new subscribers. Production/browser builds and published-package verification belong to the parent release task. No commit or push performed here.

Browser verification refinement: the queue now probes bounded nonce concurrently with account identity. Its exact EOA fixture call (owner 0x1111111111111111111111111111111111111111, nonce() selector 0xaffed0e0, gas 100,000, latest block, no sender) must return empty data as Ethereum does. The fixture accepts only that tuple, retains unknown-request rejection, and adds negative cases for changed target, selector, gas, sender and block. Product code is unchanged. With the frozen SDK candidate, 13 fixture unit tests and the focused operator browser case pass; the complete production browser suite passes 126 tests with four existing skips. ESLint, source guards and diff checks pass. Evidence remains preview-only until official SDK 2.24.3 and installed dependency contents are reconciled.

## 2026-10-07 — Keep narrow liquidity visible with reference prices

## Plan refinement

- **Objective:** Include the authorized liquidity reference markers in this release while keeping funded LP ranges visible when reference prices widen the graph axis.
- **System fit:** AmmCard displays existing pair-token-denominated reference prices and LP composition; only histogram sampling changes, with all amount calculations and transaction authority unchanged.
- **Reuse and simplicity:** Reuse the existing per-band tick intersection and weight each range by its covered fraction; retain existing reference filtering and logarithmic marker placement.
- **Evidence and unknowns:** The supplied 0.5/2 reference fixture brackets a -100/100-tick range, but none of 48 band midpoints intersects it, hiding all bars. Both pair orientations need the same normalized intersection.
- **Verification:** Assert nonzero symmetric partial-band bars for both pair orientations; run liquidity depth/presence/range tests, types, focused lint and diff checks.
- **Resource budget:** One small sampling change and one parameterized regression; production/browser verification resumes with the release owner after source freeze.

- [x] Regress widened-axis narrow ranges for both pair orientations.
- [x] Weight existing tick intersections and verify focused checks.

Review: discovered and reproduced missing depth bars when the reference-price axis [0.5, 2] surrounds a narrow -100/100-tick LP range. Both orientation regressions failed with zero bars before the fix and now pass with two positive symmetric partial-band bars; marker positions remain unchanged. Liquidity now averages the existing tick overlap across each logarithmic bucket. Token/pair amount calculations and reference sources are unchanged. All 16 focused liquidity tests, full typecheck, touched-file ESLint and diff checks pass against the published SDK 2.24.3 installation. Runtime source frozen at AmmCard.tsx SHA256 2f951e84492ee69a9a2489a3bb5ae1910749f5d44488d927a241dccdea308abb; release owner handles combined production/browser verification and commit.

Final published-release verification: official SDK 2.24.3 tarball integrity and all 745 distribution files match the tested candidate; the full installed graph differs only in SDK version/lock metadata and Vitest result timing cache. A fresh physical snapshot includes the reviewed liquidity-price graph and interval-overlap regression fix (AmmCard SHA256 2f951e84492ee69a9a2489a3bb5ae1910749f5d44488d927a241dccdea308abb). On pinned Node 26.5.0/npm 12.0.1, production build and standalone checks pass, and the complete browser suite passes 126 tests with four existing skips. The final 113,074-entry dependency hash remains unchanged and product sources match the workspace.

Bundle review: the matched HEAD 909cf1fd/official SDK 2.24.2 baseline measures 2,717,526 bytes gzip; final combined SDK/account/progress/liquidity changes measure 2,725,587 bytes (+8,061). Only the aggregate ceiling moves from 2658 to the minimum 2662 KiB. Largest operator route is 716,852 bytes and unique route JavaScript is 955,660 bytes; route and wallet lazy-loading limits remain unchanged. Final budget, touched-script lint, source invariants and diff checks pass. All comparison/source/dependency manifests and logs are under /tmp/safe-progress-final-verification.y3xQVa. Remote Linux CI and live revision checks remain parent-owned.

CI formatting correction: run37570565542 rejected one wrapped expression in AmmCard.tsx under the repository's formatting ratchet. The pinned formatter changed only that expression's line break; no formatting debt or baseline changed. The full formatting ratchet, changed-file lint and diff check pass. The new revision's complete hosted build/browser/OCI gates and live check remain required. The earlier production result remains evidence for the behavior, not a substitute for the final revision's checks.

## 2026-10-07 — Make concurrent Safe status readable and preparation passive

- [x] Put each chain's independent status beside its heading, with batch and call details below.
- [x] Hide action buttons during automatic preparation while keeping the close control and Escape available.
- [x] Verify checking/quote controls, dismissal and payment/recovery behavior with existing component suites and static gates.
- [ ] Inspect desktop/mobile renderings and affected production artifact, then publish and verify exact CI/live revision.

Plan review: apply the approved workspace refinement for the Safe modal UX correction. Existing SDK state remains authoritative; optional TxSteps heading status is presentation-only, and TxConfirmDialog accepts a null action for phases that advance automatically. Other dialogs retain default actions and sequential-step semantics. No transaction, request, funding, cancellation or recovery rules change.

Review: status text is now readable at the chain heading, separated from the batch label and call details, and announces chain context without rereading the whole list. Automatic checks/review/quote preparation keep the current steps and one phase message visible with no idle action/footer; header Close and Escape stay available. Quoted and paid/recovery controls remain intact. All67 focused queue/dialog/UI tests, full typecheck, touched-file ESLint, complete formatting ratchet, source invariants and diff check pass. Independent runtime review found no blockers. Desktop/mobile visual inspection and exact production/deployment checks remain with the coordinator.

Visual correction: a four-chain quoted desktop capture exposed existing fixed cross-axis centering clipping the header/close above the viewport. The standalone card now uses desktop automatic vertical margins while its dialog remains start-aligned, preserving centering for short cards and scrollable access for tall cards. Hosted dialogs retain their existing geometry. Final screenshots and production verification include this two-class correction.

Visual/build verification: real four-chain modal output with three decoded calls per chain was captured in checking, quoting and quoted states, then rendered with the app's freshly compiled CSS and actual fonts at desktop and390px mobile widths. All captures have no horizontal overflow or browser/font errors. Quoted desktop Close now starts at y33 instead of y-39.75, and the payment action is fully reachable by scrolling. Temporary capture instrumentation was restored byte-for-byte. The final production and standalone build passes unchanged bundle/lazy-loading gates at2,725,748B gzip (+161B); no Revnet budget change is needed. Runtime snapshot sources match the workspace. Evidence: /tmp/safe-modal-visual/visual-verification.json and /tmp/safe-progress-final-verification.y3xQVa/revnet-modal-final-proof.json. Exact hosted CI/live verification follows publication.

## 2026-10-07 — Cross-chain buyback-pool activity

- [x] Reuse the SDK grouping policy in the project feed, after filters and same-tx folding.
- [x] Keep each original chain transaction available from the grouped row.
- [x] Verify regression cases, layout, published SDK version and local release checks.

Scope refinement: Revnet's new aggregation applies to standalone buyback-pool setup rows, the reported duplicate configuration activity. Its financial rows and mixed-action transactions retain their original rows because the mapper abbreviates some token counts and does not carry sufficient exact cross-chain economic identity. Juicebox's extraction preserves all current matching behavior. Both consumers use the shared six-hour/distinct-chain policy; the UI does not infer a remote bundle ID.

Activity review: five integration regressions use the real shared SDK and the reported public transaction hashes. All four pool events become one row with four accessible explorer links; actor/time/chain isolation, financial precision, mixed transactions, filters and pagination remain correct. Existing46 feed/account/home regressions, types, lint, full formatter ratchet, source and dead-code checks pass. Actual CSS/font screenshots at300px sidebar and390/320px viewports have no overflow and retain24px chain-link targets. Official2.24.4 incorporation and production/release verification remain pending.

Activity build review: controlled preview production and standalone builds pass with the same physical dependency graph apart from the reviewed SDK grouping export. Aggregate client JavaScript measures 2,726,333 B versus 9d88fecc's 2,725,748 B (+585 B); only the minimum aggregate ceiling moves from 2662 to 2663 KiB. Largest route 717,658 B, unique route JavaScript 956,427 B and all wallet lazy-loading guards retain their existing limits. The updated budget gate, checker lint and diff checks pass; all 113,082 physical dependency entries remain identical after the build. Actual public activity captures at 1280/390/320px show four rows becoming one, all four original explorer URLs, 24px link targets and no overflow. Temporary capture tests are removed. Final official 2.24.4 archive/input equality and exact hosted CI remain required; preview evidence is not yet final release proof. Evidence: /tmp/cross-chain-activity-verification/visual-verification.json and revnet-preview-proof.json.

Official package qualification: both manifests pin published core2.24.4 with verified registry integrity. All753 distribution files equal the tested preview; unrelated dependencies and runtime source are unchanged. The measured production/standalone artifact remains valid under exact input comparison, with only approved version/lock metadata differences and the2663KiB aggregate ceiling. Final official-package rerun passes all51 activity tests, types, affected lint and full formatting ratchet. Hosted CI and exact live revision checks are tracked by the workspace release checklist.

## 2026-10-07 — Keep anonymous browsing free of wallet initialization

- [x] Remove only the root provider's idle Para mount; preserve intent preload, sign-in/add-funds, and marked-session restoration.
- [x] Add wallet-enabled provider regressions covering native idle and timeout fallback after page load, intent preload, explicit requests, and marked sessions.
- [x] Verify the focused wallet suites, touched lint, full types, and source invariants; production build/browser evidence belongs to combined integration.

Plan review: use `/Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md` (refinement gate passed), root `AGENTS.md`, pinned `workflow/ponytail/SKILL.md`/`README.md`, `docs/PLAN_REFINEMENT.md`, and relevant root/app lessons. Existing Para context, lazy host, reconnect marker, and module preload already own the behavior; remove the conflicting unsolicited mount without introducing a second wallet loader. The new provider tests run with Para enabled, and both idle cases fail on the original provider while explicit requests and session verification pass. The installed Next16.3.8 lazy-loading guide confirms the existing conditional React.lazy boundary is appropriate.

Review: all 29 focused wallet tests pass, including the new provider idle regressions and existing connector restoration/auth/host behavior. Full types, touched-file ESLint, source invariants and the full formatting ratchet, and whitespace checks pass. Independent read-only review found no blockers. Existing browser builds intentionally disable Para, so these enabled-provider timing regressions provide the direct guard; a production-environment browser network capture remains part of combined integration verification. No build, dependency installation, push or deployment was performed in this worktree.

## 2026-10-07 — Reuse client project reads during navigation

Plan: [client performance refinement](performance-client-reads.md), gated by the workspace checker and coordinator before implementation. Separate behavior-preserving extraction: 9b3c4a18.

- [x] Consolidate public complete ruleset history in the existing TanStack cache and preserve aggregate/error semantics.
- [x] Render indexed descriptions while full metadata loads; bound mutable-controller freshness and chart identity.
- [x] Verify TTL reuse/expiry, explicit invalidation, errors/recovery, data-scope changes, hydration and unchanged transaction guards.
- [ ] Coordinator: integrate with server/navigation changes and run combined production/browser/release checks.

Review: 16 focused suites pass231 tests, with typecheck, touched-file lint, full formatter ratchet, source checks, dead-code checks and diff check. Raw histories are shared across three hooks; no new cache or dependency. Exact local evidence and remaining coordinator gates are recorded in the linked plan.

## 2026-10-07 — Reuse recent project diagnostics

## Plan refinement

- **Objective:** Reopening read-only deployment diagnostics within ten seconds reuses complete evidence for the identical chain/project/operator; explicit refresh, expired, changed, invalidated and failed evidence fetch again.
- **System fit:** ProjectDiagnosticsProvider owns the sole diagnostics query; its BFF combines independent deployment and indexer evidence, displays checked time/block, and never authorizes sends. Existing Retry checks and repeated Check operator use refetch; transaction authority and saved recovery stay unchanged.
- **Reuse and simplicity:** Reuse TanStack Query's existing complete key, built-in staleTime callback, deduplication and refetch. No second policy owner or new module is needed for one consumer; complete responses receive a ten-second lease while read failures or missing/incomplete indexed evidence remain immediately stale. Switching operators A to B to A may reuse fresh A evidence; repeated Check operator on unchanged A and Retry checks always fetch.
- **Evidence and unknowns:** Read workspace AGENTS.md, workflow/ponytail/SKILL.md and README.md, docs/PLAN_REFINEMENT.md, relevant workspace/app lessons and local Next caching docs. No descendant AGENTS.md exists. Baseline 81aeb708 uses staleTime zero; every caller and response fallback was traced. Installed Node 26.7.0 is available, required release Node 26.5.0 is absent; integrated pinned-toolchain release verification belongs to the coordinator.
- **Verification:** Render the real provider with a real QueryClient to prove fresh reuse, exact expiry, invalidation, changed identity, explicit refresh, in-flight deduplication and failure/degraded retry. Run existing diagnostics loader/route/index-status tests, full typecheck, focused ESLint, complete formatting ratchet and diff checks; no production build/deploy in this worktree.
- **Resource budget:** One isolated worktree at .worktrees/perf-revnet-preparation with existing node_modules symlink; edit only the owning component, its existing focused suite and this record. One focused regression pass plus repository static gates; replan if endpoint semantics or identities make bounded reuse unsafe.

- [x] Implement complete-result diagnostics freshness in its existing owner.
- [x] Verify rendered reuse and failure recovery with the real query cache and affected suites.
- [x] Record exact checks and commit the focused change for integration.

Review: complete diagnostics now reuse the existing chain/project/operator query for ten seconds. No new owner, key or transport cache was added. Explicit Retry checks and unchanged-operator Check still refetch; A/B/A selection can reuse the exact fresh A result. Null deployment, unavailable checks, missing/incomplete indexer evidence and failed refreshes remain immediately retryable; prior data is never displayed/copied after a failed refresh. Baseline regressions reproduced extra reopen/remount requests. Final verification: 33 tests passed across project-diagnostics, project-diagnostics-route, project-diagnostics-loader and project-index-status; full typecheck, focused ESLint, complete formatting ratchet (two unchanged debt entries) and diff checks pass. Read-only independent policy review found no authority-safety blocker. Verification used installed Node 26.7.0, TanStack Query 5.101.4, Next 16.3.8 and Vitest 4.1.10; exact pinned-toolchain/dependency integration and production/browser checks remain coordinator-owned. No build, install, push or deployment ran here.

## 2026-10-07 — Server project-read performance

Required workspace resources remain authoritative in this isolated checkout: `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, `/Users/jango/Documents/jb/v6/evm/workflow/ponytail/SKILL.md`, `/Users/jango/Documents/jb/v6/evm/workflow/ponytail/README.md`, `/Users/jango/Documents/jb/v6/evm/docs/PLAN_REFINEMENT.md`, `/Users/jango/Documents/jb/v6/evm/tasks/lessons.md`, and this repository's `tasks/lessons.md`. Parent authorization and scope: `/Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md`.

## Plan refinement

- **Objective:** Shorten project opening and repeat tab visits through shared indexed reads and progressive secondary rendering, while returning genuine missing-project HTTP errors before streaming and retaining retryable upstream failures.
- **System fit:** Server project/group readers own public indexed evidence consumed by metadata, layouts, tabs and previews. React request memoization shares one render; the existing TanStack dependency will own a process-local public display cache. Alias verification and final transaction authorization remain with their existing live owners; no wallet, account or send evidence enters this cache. Display invalidation follows metadata completion and explicit Retry.
- **Reuse and simplicity:** First extract the existing async layout body without changing its awaited behavior, prove regressions and commit it independently. Then reuse QueryClient.fetchQuery for exact family/chain/project-or-group keys, a 30-second freshness window, five-minute garbage collection, one in-flight read and no automatic retry. Only available indexer results are reusable; missing, incomplete and failed reads retain their original status and retry on the next request. Next unstable_cache is already used elsewhere but its stale-while-revalidate behavior can retain expired successes after failure, so it cannot enforce this bounded reuse rule without an additional stale-data protocol.
- **Evidence and unknowns:** Baseline is clean 81aeb708; installed Next16.3.8 loading and unstable_cache documentation/source confirms same-segment layout blocking and stale-while-revalidate semantics. Number/bigint keys currently split request memoization. Metadata invalidation runs immediately before its existing delayed refresh; Retry evicts the affected project and group, including unresolved group reads scoped by their requested tuple before membership is known. Eviction cancels known affected fills: supplied group IDs also identify pending peer reads, while unknown peer membership and other server processes retain the 30-second expiry backstop. Metadata refresh supplies each known group ID; public Retry never cancels unrelated pending reads. Indexer freshness itself is not a claim of onchain authority.
- **Verification:** Focused tests cover equal number/bigint callers, metadata/layout/page deduplication, chain/project separation, reuse through30s then fresh reads, negative/error/incomplete retry, explicit invalidation including a pending stale fill, and layout identity/not-found resolution before secondary streaming. Hold group/ruleset/operator reads to prove independent progress. Preserve onchain outage/fallback and metadata-write tests, run pinned Node26.5 focused tests/types/touched lint/formatter ratchet/source checks, and leave combined production/browser gates to root integration.
- **Resource budget:** Work only in `.worktrees/perf-revnet-server` on `perf/revnet-server-reads`; original node_modules is a read-only link for focused checks, with no installs/builds against it. One read-only cache reviewer checks architecture while implementation proceeds. Avoid changing alias/client-provider domains; coordinate shared props and invalidation. Replan if strict freshness, streaming status semantics or existing mutation tests cannot be preserved.

- [x] Extract the layout's existing body without changing await boundaries and commit passing regression checks.
- [x] Normalize indexed keys and add bounded successful-result reuse plus targeted invalidation tests.
- [x] Stream group-backed content only after authoritative route/project checks; let start-date and operator display resolve independently.
- [x] Wire Retry and metadata completion to server display invalidation; verify shared read owners and recovery.
- [x] Run focused checks and record exact commits, limitations and integration gates.

Review: behavior-preserving layout extraction is commit 11c7b631; bounded display reuse is c881dc02. Header skeleton extraction is dda04735, with exact rendered HTML equality for both populated and empty hints checked before reuse. The final layout retains route/project existence checks before its own streaming boundary, shows the known identity while group/operator data waits, and renders start-time and chart failures locally. Group success eligibility includes the requested project; all production callers now use that normalized key. Explicit invalidation cancels exact and known-group fills, retains unrelated reads, and documents unknown peer/replica expiry rather than promising global consistency. An independent cache review found no remaining blocker. On pinned Node 26.5, all 71 focused tests across 8 suites, full typecheck, touched-file ESLint, source invariants, formatter ratchet and diff checks pass. Navigation identity-boundary wiring and combined production/browser/404 measurements remain parent integration work; no build, dependency install, push or deployment occurred in this worktree. The shared installed graph reports Vitest 4.1.10 versus manifest 4.1.9, so these focused checks do not replace the parent's locked-install integration qualification.

## 2026-10-07 — Retained project navigation

Uses workspace AGENTS.md, workflow/ponytail/SKILL.md and docs/PLAN_REFINEMENT.md at /Users/jango/Documents/jb/v6/evm. Approved design and six-field refinement: /Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md (gate passed).

- [x] Extract duplicated subtab URL owner without behavior change.
- [x] Add request-verified alias snapshot, short successful reuse and whole-project/page identity gate.
- [x] Switch tabs/subtabs/graph ranges to retained navigation preserving URL state.
- [x] Verify expiry, failures, rebinding, page/layout races, history and state retention.

## Plan refinement

- **Objective:** Retain alias tab, graph and history navigation without exposing actions for another binding; normal long transaction review remains usable.
- **System fit:** Server resolver remains identity authority; client navigation checks its five-second successful proof; ProjectPageBoundary compares child/layout tuples. Existing TransactionReviewProvider captures the initiating alias scope and checks it at approval, cancels unapproved dialogs on scope changes, and leaves durable transaction recovery unchanged.
- **Reuse and simplicity:** Native history handles local URL state, TanStack coalesces reads, and the existing global review queue owns scoped approval. Remove broad click capture instead of intercepting arbitrary form/dialog interactions or changing thirteen write callers.
- **Evidence and unknowns:** Independent review found global review dialogs live above the project boundary and bypass descendant capture; native dialogs also obscure an external Retry. Installed Next16 docs confirm retained layouts and refresh merging, requiring explicit keys and page acknowledgements. Exact pre-send protection after a completed review is investigated separately from alias approval.
- **Verification:** Exercise actual global review provider with deferred verification, expiry, cancellation, rebinding and simultaneous queued dialogs. Assert no approval from an obsolete id/scope after awaited work; retain existing review and recovery suite; cover real alias browser tabs, subtabs, graph range and history without documents.
- **Resource budget:** A focused optional scope API in the existing review owner avoids wider financial pipeline edits. Use isolated worktree and parallel read-only review; final production browser verification belongs to the combined branch with server wrapper installed.

### Navigation implementation review

- `resolveProjectRoute.server.ts` remains the sole bidirectional alias/authority resolver. Request-only `connection()` prevents full-route caching; `/api/project-route` returns no-store successful proof timestamps.
- `projectRouteQuery.ts` owns the memory-only, nonpersisted five-second lease and explicit invalidation. `localCheckedAt = requestStartedAt - (serverNow - checkedAt)` charges full transport time and tolerates server/browser clock skew; a response slower than the lease is rejected. SSR snapshots trigger one client verification because server time cannot safely establish browser freshness. No idle polling.
- The whole provider subtree is keyed by chain/project/operator, and each server page acknowledges its own identity before actions are exposed. Native history preserves unrelated parameters/hash. Native project dialogs release the top layer during verification without losing mounted form state.
- Global transaction review captures the active project scope and checks it at approval/funding selection; cancellation/id checks prevent late async proofs approving another dialog. Saved transaction journals are unchanged. Alias scope is checked at approval; existing per-action authority, simulation and account checks still own later send validation.
- Combined production/browser validation requires the server-worker layout wrapper and is assigned to integration. Focused tests include browser regressions replacing prior document-reload expectations.

### Refined alias rebinding recovery

Root architectural decision: ordinary same-project tabs, graph controls, history and successful expired-proof checks never reload the document. A positively verified change of tuple/operator replaces the document once, which also cancels old JavaScript preparations before they can enqueue under a new scope. Failed verification never reloads and retains Retry plus the original numeric project link. This exception avoids broad changes to financial execution owners while retaining their previous cancellation boundary. Tests distinguish same-binding/no-document, changed-binding/one-document, and failed-proof/no-document behavior.

## 2026-10-07 — Verify the combined website performance changes

## Plan refinement

- **Objective:** Qualify the combined wallet, server-read, client-cache and retained-navigation changes against repository release checks and measured project/tab/graph journeys.
- **System fit:** The layout's verified route snapshot surrounds project providers, while child snapshots acknowledge the same binding; indexed display caching and metadata invalidation retain their separate owners. Alias proof gates review scope, and existing final transaction/recovery checks remain authoritative.
- **Reuse and simplicity:** Preserve both append-only task records and combine the navigation page wrapper with the existing streamed chart. Add only the agreed layout wrapper and a meaningful integration assertion, then reuse the repository's pinned CI/build/browser tools and unchanged baseline comparison scripts.
- **Evidence and unknowns:** Combined server/client/diagnostics changes have passed focused checks; baseline production client JavaScript already exceeds its aggregate budget slightly. Final navigation integration, exact production size, 404 behavior and browser journeys remain unverified. Build inputs use the locked install and pinned Node 26.5/npm 12; root owns Docker and Para-enabled production smoke.
- **Verification:** Run full dependency, environment, deployment, type, lint, formatting, source, dead-code, protocol, wallet and coverage gates; build the production browser artifact, verify standalone output and measured budgets, then run the complete two-worker browser suite and unchanged comparison journey. Diagnose failures before modifying source or budgets.
- **Resource budget:** One owner mutates this integration checkout and serializes builds; fixture ports 4173/4174 are confirmed free. Use the existing log runner and bounded progress polling, preserve baseline artifact/source hashes, and rerun checks only for relevant subsequent changes or failures. No push or deployment is authorized by this verification.

- [x] Preserve both task histories and merge the streamed overview with its identity boundary.
- [x] Wire and verify the whole-project layout identity boundary.
- [x] Run complete static, coverage, production, browser and actual HTTP-status checks.
- [x] Run the matched physical-baseline/final comparison after other builds and probes stop.
- [x] Record qualified source revision, evidence and remaining measurement handoff.

Integration merge review: navigation extraction 2e4652e7 and behavior 656f9a16 preserve both task histories, every requested-project group key, and the streamed StartedProjectChart. The layout now supplies the same verified snapshot to the boundary enclosing all project providers. All 99 focused integration tests across nine suites pass, including the real navigation/cache suites and a new parent/child snapshot assertion. Full release checks follow this source commit.

Final review refinement: an observerless in-flight alias proof can finish after mutation invalidation and erase the invalidated state. Cancel affected fills before marking their query family invalid, retaining the marker so a fresh initial snapshot cannot bypass the mutation. Add a deferred pre-mutation response regression and retain existing failed-proof/fresh-initial refusal coverage. Full integration also found a legacy confirmation test mocking away the newly consumed useQueryClient hook; preserve its controlled authority reads while exposing a real query client for cancellation/invalidation. The alias browser readiness assertion needs a real marker on the boundary it observes. These are targeted correctness/verification fixes before the production source freeze.

Independent final review: the deferred proof test failed before cancellation and now fetches the rebound identity; failed endpoint proof still cannot fall back to a fresh initial lease. A second regression proves same-alias refreshed server props cannot replace the originally mounted binding without the exceptional document reset. A lagged indexed isRevnet:false flag also reproduced missing child content despite live alias proof; the layout now prefers that already-verified REVOwner evidence. All three affected confirmation mocks expose a real QueryClient. The navigation owner independently reviewed the merged layout, streamed page, keys, cancellation and metadata paths and reported no remaining blocker, pending full/runtime checks.

Bundle refinement: the final server display-cache import through @tanstack/react-query introduces 13 React client-hook references into each affected server route manifest, versus zero in the matched baseline. The installed @tanstack/query-core 5.101.4 export is the identical QueryClient class. Import it directly in the server owner and explicitly pin that existing package in manifest/lock metadata, without changing physical dependencies or cache semantics. Rebuild and measure before considering any bundle-ceiling change. The positive payment draft in the new alias browser test also revealed an unsupported previewPayFor fixture call; retain that scenario, add only its exact contract-derived response and negative request cases, and keep unknown-request rejection strict.

Core-import measurement: a09d6edc removes all 13 unwanted React Query client references and saves 8,252 bytes gzip; largest route drops below baseline, but aggregate remains 30,332 bytes above it. Parsed modules still duplicate review/provider and full route-gate code across page consumers. A behavior-preserving extraction now gives review scope and project context/page-boundary/navigation hooks their own lightweight owners, with every caller migrated and no policy change; its checked plan is tasks/performance-navigation-imports.md. The fixture correction accepts only the traced terminal/project1/USDC/12,000,000/guest-zero-address/empty-metadata preview tuple, deriving beneficiary/reserved tokens from the existing fixture weight and reserve percent and rejecting altered requests. No bundle limit has changed.

Final source verification: context extraction f1ec03e9 and exact preview fixture 961f01c4 pass independent reviews. With the locked physical dependency graph and pinned Node 26.5/npm 12, all dependency/audit, dead-code, environment, deployment, type, lint, formatting, source, protocol and wallet gates pass. Full coverage passes 2,386 tests across 253 suites, with one existing skipped test/suite (statements 65.81%, branches 60.23%, functions 63.19%, lines 67.92%). The combined production and standalone builds pass. Context extraction removes the repeated SDK/review/gate modules and saves another 24,069 bytes gzip; the final aggregate is 2,733,461 bytes and route-referenced JavaScript 960,296 bytes. A physical-copy baseline build is required before the final aggregate-ceiling decision because the earlier baseline used symlinked dependencies, which can change webpack module identities and compression despite equal package contents.

Browser-test refinement: the retained alias journey now reaches the valid positive payment preview. Its next assertion incorrectly expected a pool-only selector on a fixture whose IndexedBuybackPools response intentionally has no events. Replace that impossible action with a second supported Time range selection and browser Back/Forward, retaining assertions for range, URL filter/hash, Amount 12, Terms/Overview and zero document requests. Keep unknown fixture requests rejected. This is test-only; it neither fabricates pool data nor claims browser coverage for smooth/trade modes. The complete browser suite must pass again on this corrected test before qualification.

Physical-baseline refinement: the baseline's dependencies are now an APFS physical copy whose package files and internal links match the integration tree; only Vitest's generated results cache changed during coverage. Clean 81aeb708 preserves its original package/lock hashes, and its build, standalone and original budget gates pass. The correct aggregate comparison is 2,726,293 to 2,733,461 bytes (+7,168, or 0.26%); route-referenced JavaScript is 956,388 to 960,296 bytes (+3,908), and the largest route is 717,633 to 721,049 bytes. This supersedes the symlink comparison's apparent route decrease. After removing the duplicated SDK/provider/gate and server React-hook imports, the residual cost is the required navigation verification and display/recovery behavior. Root approved only the minimum aggregate ceiling, 2663 to 2670 KiB; retain every route and lazy-loading limit. Verify the existing budget-checker regression suite, checker lint, source invariants and the actual production artifact. Physical provenance and comparison reports are `/private/tmp/jb-performance-checks/revnet-baseline-physical-provenance.json` and `revnet-bundle-physical-comparison.json`.

Qualification review at 8fbf2e66: all final static and coverage gates pass, as do the production build, standalone and measured bundle gates. The complete corrected browser suite passes 131 tests with four existing skips and no flaky retries, including every viewport's alias range/history/draft journey. The aggregate adjustment passes 19 checker regressions, focused lint/format, source invariants and independent review; route and lazy-wallet limits are unchanged. Actual compiled-server probes return HTTP 404 for explicit ERC721NonexistentToken evidence and HTTP 500 for unavailable RPC evidence, with exact request assertions and no unknown requests. Reports: `/private/tmp/jb-performance-checks/revnet-final-complete.json`, `revnet-final-artifact.json`, `revnet-final-browser-corrected.json`, and `revnet-http-status-final.json`. The application remains byte-equivalent to the production container built from 961f01c4; later changes affect only browser assertions, the budget checker and this record. Parent-owned least-privilege container health/revision/image checks pass. No push or deployment occurred.

Remaining measurement protocol: rerun both the newly physical baseline and final artifact with the same final fixture and identical comparison script, after the parent confirms other builds/browser probes are quiet. Use fresh browser contexts, retain server-cache conditions in the report, assert real content and reject unknown requests/errors. Report cold versus warm observations and request counts without treating local deterministic timings as live-site speed estimates. Earlier symlink and fixture-version timing reports are superseded.

Matched comparison review: physical baseline 81aeb708 and final c035600a use identical fixture/script/Node/Playwright hashes, with no competing builds or browser probes. Both complete all content/error checks. Across three numeric journeys, indexed Project requests fall 51 to 4, SuckerGroup 33 to 4, raw allOf reads 6 to 3, and route RSC requests 87 to 60. One alias journey falls from six documents to one initial document, Project 16 to 1 and SuckerGroup 9 to 1; all final tabs/history preserve the document, and graph selection issues no route RSC. Original locator timing is mixed: numeric initial median 251 to 195 ms and graph selection 40 to 19 ms, but first Terms is roughly unchanged at 845 to 850 ms, and alias Terms appears substantially slower. These raw reports remain in `/private/tmp/jb-performance-checks/revnet-comparison-summary.json` and the referenced paired reports; no universal speedup claim is supported.

Bounded timing diagnosis: a separately reviewed temporary observer records actual capture-phase click time and the first simultaneous destination URL/selected-tab/financial-content/ready-boundary match, using a shared monotonic epoch clock and sessionStorage across baseline document navigations. It preserves every original assertion. The first attempt required an initial chart that the original readiness callback never promised; it stopped without accepting a measurement, and its failed report is retained. The corrected identical observer runs three numeric and three alias journeys per artifact and passes all checks. Numeric initial DOM-ready medians are 185.5 to 181.6 ms, first Terms 348.9 to 351.2, and Terms revisit 19.6 to 20.8. Alias Overview return improves 134.2 to 49.4 ms, while first Terms is 153.6 to 367.9 and revisit 148.7 to 330.5: a real local 180–214 ms regression remains, amplified by locator polling into roughly850 ms. Alias boundary checks take only a few milliseconds and its RSC responses finish roughly30 ms after request; the later DOM availability is consistent with installed React's300 ms Suspense fallback throttle. This is source/capture attribution, not an isolated framework-cause experiment. Initial chart completion is unmeasured; observer availability is not exact paint. Original cold-start variation remains visible, and these local deterministic timings do not estimate live-site latency. No runtime changes were made to chase the diagnostic. Evidence: `/private/tmp/jb-performance-checks/revnet-comparison-observed-summary.json` and its raw paired reports. All owned processes are stopped and fixture ports are free; parent receives the verified implementation plus this explicit limitation for the next performance decision.

## Follow-up — Attribute and shorten tab readiness

- [x] Follow the checked [tab readiness plan](performance-tab-readiness.md): attribute the existing fallback first, then isolate one loading-boundary experiment if supported.
- [x] Preserve deep-link, slow/error, identity and financial behavior; qualify the accepted change with matched DOM measurements and repository gates.

Plan review: the first batch remains immutable. The reviewed deletion-only experiment proves the repeated route fallback cost: matched alias Terms revisit DOM readiness330.6→39.9 ms and numeric first Terms354.1→61.6 ms. Final work moves the existing fallback into one persistent content boundary and adds one shared pending destination in ProjectMenu, retaining committed selection and all authority rules. The plan checker passes; cold/slow/interrupted acceptance and final release gates remain required. An unrelated4173 preview stays untouched; temporary matched probes use4175 with an exact fixture CORS-header adapter. The unchanged full browser suite will run in hosted PR CI before merge.

Final recovery review: application source remains unchanged after 2cecaa32; tested head 63e6b539 adds the cold-content and interrupted-navigation regressions. All required local static/advisory/protocol/coverage/artifact checks pass, with 2388 unit tests and 139 production browser tests. Numeric and alias cold-stream proofs, genuine 404 versus unavailable 500, numeric native pending and failed-alias Retry/draft recovery pass. The matched final design removes the measured floor: numeric first Terms 340.4→63.7 ms; alias first Terms 373.5→71.9 ms, revisit 331.5→41.1 ms and second Overview 337.2→41.2 ms. All twelve journeys preserve documents and exact financial content; Terms request counts and whole-pair query/contract-read counts do not grow. Timings are local DOM observations, not live percentiles. The [full qualification record](performance-tab-readiness.md#final-qualification-review) names raw reports, artifact provenance and retained failures. Independent review found no source blocker; root owns hosted checks and release.

## 2026-10-07 — Match Juicebox activity row hierarchy

Root `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, pinned `workflow/ponytail/SKILL.md` and `README.md`, `docs/PLAN_REFINEMENT.md`, relevant root/app lessons and installed Next 16.3.8 CSS guidance reviewed. No descendant AGENTS.md applies in this checkout. Isolated from both performance worktrees at production `ff2a3ceacd6d21ede7aff61598bbd1bdd7df2dc7`.

## Plan refinement

- **Objective:** Give Revnet's project/account activity the requested Juicebox row hierarchy: action badge, prefixed actor, time beside overlapping chain links, and compact auto-issuance quantities with exact values available.
- **System fit:** `ActivityItemRow` owns both project and account rendering; `mapActivityEvents` owns amount presentation, while `number.ts` owns compact formatting. Preserve event/transaction identity, grouping, attribution, financial meanings, original explorer links, query freshness, transaction authority and recovery. Root owns review, deployment and final production verification.
- **Reuse and simplicity:** Reuse the shared row, existing semantic bullets, profile/date/chain/link components and compact-number formatter. Keep the established Simplon typography/palette and existing inflow/outflow/reserved treatment. Add only action labels and exact-token display metadata where auto-issuance starts abbreviating; no new component, dependency, data source or cache.
- **Evidence and unknowns:** Both source flows confirm the gap: amount-less Revnet rows replace the badge with the actor, chain links have 24px spaced wrappers around 14px marks, and auto-issuance bypasses the compact formatter. Juicebox already supplies badges and overlapping 18px marks. Screenshots motivate layout; rendered mobile/desktop geometry still needs verification, and preserved first-batch tests do not qualify these edits.
- **Verification:** Extend existing mapper/row tests to cover compact large/tiny auto-issuance with a lossless exact title, action labels and actor prefixes, flow preservation, every explorer destination and semantic grouping. Run focused tests, type/lint/format and source gates, then obtain a quiet slot for production build/bundle and browser verification; check mobile/desktop wrapping and icon geometry without changing the performance probe/harness. Required CI/release checks remain root-owned.
- **Resource budget:** One writer in this isolated checkout; minimal runtime owners and existing tests. No build, browser, timing probe or heavy dependency work until root grants the slot. Preserve unrelated processes and worktrees, and replan if amount semantics or bundle limits would change.

- [x] Implement the shared row hierarchy and owner-level quantity presentation.
- [x] Verify focused regressions and repository gates; inspect responsive production output in an assigned slot.
- [x] Record evidence, independent review readiness and commit the isolated change for root delivery.

Consumer check: the homepage also consumes `mapActivityEvents`' auto-issuance count, so its existing summary retains the same exact-token title. Its layout and grouping remain unchanged. The quantity's full decimal string is grouped directly, avoiding floating-point conversion for the exact value.

Review refinement: mint, auto-issuance, reserved-split and item-mint rows identify recipients rather than necessarily the initiating caller. Their new attribution line says `to`; administrative actors say `by`, preserving existing flow/distribution wording and mapped identities. Regressions use different caller/beneficiary accounts so the layout cannot imply that the recipient initiated the transaction.

Source review: independent review reports no remaining source blocker. All 54 focused tests across activity mapping, row rendering, cross-chain grouping, swap direction, account merging and filters pass. Physical locked dependencies match the verified first-batch graph (113,031 distinct files and 51 internal symlinks); provenance is `/private/tmp/jb-performance-checks/revnet-activity-physical-provenance.json`. Full gates and rendered checks follow the combined candidate below.

## Plan refinement

- **Objective:** Qualify the activity presentation on the reviewed performance follow-up tree that will precede it in production, while keeping activity separately reviewable.
- **System fit:** Commit the activity-only delta from first-batch production, then merge the independently reviewed performance branch into this activity worktree. Root owns stacked PR delivery, performance-first promotion, exact tree checks and production verification; both task histories remain evidence.
- **Reuse and simplicity:** Merge disjoint runtime owners without rewriting either change. Reuse the verified physical dependency clone and final existing CI checks once on the combined source; no install, formatter policy change or harness port change.
- **Evidence and unknowns:** The activity-only source passed independent review and 54 focused tests. Performance `63e6b539` (or its notes-only final successor) has independent qualification. Merged source, bundle size, full coverage and browser layout still need qualification and must not inherit a passing claim from either separate base.
- **Verification:** Resolve only append-only task-history conflicts, inspect the runtime union, then run every CI/package gate, production build, standalone/bundle checks and full browser suite. Supplement the unchanged browser harness with a deterministic activity-response/profile overlay on desktop/mobile to inspect overlapping links, exact quantities, attribution and wrapping.
- **Resource budget:** One combined local gate/build sequence after the root releases the timing slot; coordinate 4173/4174 with the performance owner. No push/deploy here. Replan instead of relaxing a bundle cap or changing data semantics if combined verification fails.

### Activity qualification review

Activity-only `8f9bd2bf` is stacked on final reviewed performance `d8e9f9ea` through merge `06575d32`; only this task history conflicted, and both appendices are preserved. Runtime source and performance tests match their respective reviewed changes exactly. No runtime edits followed the successful source/coverage/build/browser checks.

Pinned Node 26.5.0/npm 12.0.1 with verified physical dependencies passes every local package/CI gate: dependency integrity/audit, environment/deployment, types, lint, formatting ratchet, source/dead-code, pinned protocol and wallet inventory; 2,395 coverage tests across 254 suites pass, with one existing skipped test/suite. Production build and standalone checks pass. Bundle output is 2666.6 KiB aggregate, 934.9 KiB route-referenced and 689.5 KiB largest route, within every unchanged cap. The complete unchanged browser harness passes 139 tests with six declared skips and no flaky retries.

Supplemental production rendering passes at 1280, 390 and 320 pixels: all four original chain transaction links remain individually named/focusable; 18px marks advance 12px for a 6px overlap; intrinsic logo proportions and exact token titles survive; rows have no horizontal overflow, browser errors, external attempts or unknown fixture requests. Both worker and root visually inspected the hierarchy and keyboard focus ring. The test-only activity/profile response overlay is recorded in the report; it changes neither app source nor the normal browser harness and is not a performance measurement. Clean screenshots also preserve the same rows after clearing keyboard focus.

Evidence lives under `/private/tmp/jb-performance-checks`: `revnet-activity-final-source.json`, `revnet-activity-build.json`, `revnet-activity-full-browser.json`, `revnet-activity-browser.json`, `revnet-activity-browser-clean.json`, `revnet-activity-physical-provenance.json`, and final `revnet-activity-verification.json`. Screenshots: `revnet-activity-clean-{1280,390,320}.png` (focused originals are retained). Independent source review has no remaining blocker. No push/deployment was performed; root owns hosted PR/container checks and exact production verification. All owned browser/app/fixture processes are stopped.

## 2026-10-07 hosted hydration and alias-test readiness repair

## Plan refinement

- **Objective:** Complete the activity release with stable returning-visitor hydration and meaningful retained-draft checks; preserve existing financial semantics, persisted reuse, SSR, and all browser error/flaky gates.
- **System fit:** Hosted React 418 traces and actual-component hydrateRoot diagnostics identify Header treasury/participant display as the owner. The alias draft failure is an inert-boundary test setup race, proved with the real authority lookup; application payment state remains unchanged. Root owns release and root evidence; this checkout owns the isolated source repair, exact checks, and local task record.
- **Reuse and simplicity:** Extract the identical useSyncExternalStore hydration rule from RevnetSearch, AddStageDialog, V6TokenPanel, V6SplitsSubtab, and PendingRoutingPayments into useHydrated in a separate behavior-preserving commit. Reuse that component-local snapshot in proven affected display consumers and retain the existing QueryClient, persister, query keys, transaction checks, and browser harness.
- **Evidence and unknowns:** Header/TvlDatum actual persister diagnostics fail deterministically before repair with server ellipsis versus cached $1,250.00/2; these files predate the performance follow-up. Preserve 2bd042fb's complete compiled artifact and old logs. Reviewer identified concrete Market/Settlement siblings for bounded actual-component diagnosis before final scope; no global cache flush, hydration suppression, or arbitrary wait is evidence of repair.
- **Verification:** Keep separate extraction checks, permanent failing-before/passing-after hydration regressions that retain the SSR DOM node and expose cached data after hydration, and a shared ready-before-fill assertion in all three alias draft tests. Run complete required source/unit/build/bundle/browser gates under pinned Node26.5/npm12, then root coordinates final direct-DOM performance and production qualification.
- **Resource budget:** One writer; diagnostics stay in /private/tmp and existing artifacts remain immutable. Test five extraction callers once, prove concrete sibling failures before touching them, then run full gates only on the final reviewed source. Replan if causal evidence widens scope; no dependency re-resolution, CI retry-until-green, or release action from this agent.

- [x] Preserve original 2bd042fb compiled artifact and prove all files/symlinks equal.
- [x] Attribute hosted hydration and draft setup failures with deterministic source-owner evidence.
- [x] Extract the existing hydration rule with no behavior change; all 31 existing tests across5 callers pass. Separate refactor commit precedes display behavior changes.
- [x] Reproduce concrete sibling consumers and implement the proven owning display fixes. Permanent regressions cover all 9 Market/Settlement consumers, positive bridge/movement data, Header count/error/revalidation states, SSR node preservation, and immediate cached display on ordinary client navigation.
- [x] Correct shared alias-test readiness and assert the initial draft before testing retention; no payment runtime changes.
- [x] Complete independent source review and full required local gates; hand exact candidate/artifact to root for hosted checks, final paired timing and release.

Preserved original artifact: `/private/tmp/jb-performance-tools-20261007/revnet-activity-2bd042fb-preserved/.next`; 3,351 files, no symlinks, every byte equal. Manifest: `/private/tmp/jb-performance-checks/revnet-activity-2bd042fb-artifact-preserved.json`, manifest SHA256 `ed6a07fc56427a3b8ca8e4be8da465dd29889fd3ababb0735a43560154b6e733`.

Bounded sibling refinement: the reviewer reproduced actual MarketPriceChart and BridgesCard with persisted empty query results restored before hydration; both replace their SSR skeleton tree with client output and report React hydration errors. Root approved those display owners and the only other renderer of the same key, AmmCard (`v6AmmStates`); `v6Bridges` has no second renderer. Reuse the component snapshot, preserve disabled/no-chain behavior and all query policies, and require real-persister regressions before full gates. Other unrelated query owners remain outside this bounded release repair.

Final bounded scope (root approved after independent proof): all 9 actual Market/Settlement consumers fail on pinned99569648 source with valid persisted data: MarketPriceChart, AmmCard, SplitHookCard, BridgesCard, AcrossChainsCard, GossipCard, QueuedMovementsCard, V6MarketSubtab ticker and V6SettlementSubtab ticker. Apply the same display-only per-component snapshot to these owners; keep query keys, enablement, polling, stale times, empty-chain behavior, mutation paths and SSR headings/skeletons unchanged. The permanent regression uses valid per-chain AMM/across-chain/gossip records and the actual persister. No further sibling discovery or unrelated query changes are part of this repair. Before evidence: `/private/tmp/jb-performance-checks/revnet-market-settlement-hydration-before.log`.

### Repair verification and handoff

The extraction is commit `99569648`; the independently reviewed runtime repair is `2e88d53800450096bdbeb3b5ca657deeec4a9e15`. Tested head `0c8ebe086fc90798906b01bc39315a2b305fadaa` only adds the correct SDK `native` transport literal to the queued-movement regression fixture. The final task-record successor changes no runtime, test, dependency or build input.

- Independent actual-component diagnostics fail all 9 Market/Settlement cases on pinned995 source and pass all 9 after repair. Permanent regressions cover 8 Header hydration states, the first ordinary client-navigation commit, all 9 sibling owners, positive bridge data and queued movement counts. All28 focused tests pass; all 31 existing extraction-consumer tests pass.
- Required static, dependency, production audit, environment, deployment, type, formatting, dead-code, protocol and wallet-boundary checks pass. Complete `test:ci` passes 2,415 tests with 1 existing skip; 256 suites pass and 1 is skipped. Coverage: statements 66.55%, branches 60.91%, functions 64.08%, lines 68.66%.
- `build:browser`, `standalone:check` and unchanged bundle budgets pass: aggregate 2,666.7KiB gzip (cap 2,670), route-referenced 935.0KiB (cap 1,100), largest route 689.6KiB (cap 900). Build ID `build-TfctsWXpff2fKS`.
- The unchanged full production browser harness (`CI=true`, `failOnFlakyTests` retained) passes 139 cases with 6 declared skips and no retries/flakes. The separate saved-cache probe passes 16 full numeric/verified-alias Owners/Shop/Extras/Operator reloads at 1280/390 widths with zero page errors, external requests or unsupported fixture requests. It waits for actual persisted keys; it neither injects cache data nor forces query updates.
- First-run failures are preserved: restricted network/listener scope blocked npm advisory/live schema/local contract-server checks; those same required checks pass with the authorized scope. Typecheck exposed the new fixture's obsolete `optimism` enum; changing it to the SDK's `native` value passes its focused regression, typecheck, lint, formatting and final full coverage. The temporary returning-cache probe initially used a 5-second default predicate deadline; the existing 15-second participant poll plus 1-second persistence debounce required the bounded 30-second readiness check. No application source changed during these verification corrections.

Evidence is under `/private/tmp/jb-performance-checks`: `revnet-hydration-final-source.json` preserves the first gate batch; `revnet-hydration-final-network.json` records successful required audit/full coverage; `revnet-hydration-fixture-{correction,typecheck,lint,format}.log` qualifies the test-only correction; `revnet-hydration-build.json`, `revnet-hydration-full-browser.json`, and `revnet-hydration-returning.json` record final qualification. The first saved-cache precondition diagnostic is retained as `revnet-hydration-returning-precondition-5s.json`.

Complete artifact manifest: `revnet-hydration-artifact.json`, 3,352 files, manifest SHA256 `8ff9caeb9c6f26a7a351e49a5e1c3dc475400880a1604a009662ff0857fe3d94`; tested source tree `e02fde16285da30859bd1c8a11784fbcaa4eb8dd`. The prior 2bd artifact and all earlier activity evidence remain retained separately. Browser ports were released to the performance owner after all local functional checks; this writer will not run concurrent builds/browsers during final timing. Root owns hosted CI, exact production promotion and public verification; no deployment or wallet transaction was performed by this writer.

## 2026-10-07 service-neutral transaction copy

Owning refined plan: `/Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_RELEASE_FOLLOWUPS.md`; required refinement gate passed before source edits. Isolated branch starts at deployed `acaf540b`; root retains release authority and coordinates the separate permission and simulation fixes.

- [x] Replace controlled visible service branding with action/status copy, retaining internal names, links and legacy storage discriminators.
- [x] Reuse `formatWalletError` for SDK errors and one shared display formatter for saved transaction text; preserve original errors and persisted records.
- [x] Prove actual Safe pending/failure and saved-history rendering, legacy release compatibility and focused caller regressions; run relevant static gates and hand off the scoped commit without deployment.

### Copy verification review

The controlled transaction status/review/recovery copy and public guide labels no longer name the background service. Internal symbols, API URLs, stored keys and the exact `LEGACY_RELEASE_MESSAGE` discriminator remain. New saved messages use neutral copy; existing journal rows and SDK error objects are not rewritten. `formatTransactionMessage` is the shared display owner, reused by wallet errors, transaction-confirm status/errors, account history and saved routing explanations. The simulation wording preserves the chain and revert detail; generic transport failures retain their HTTP status and do not become a simulation diagnosis or a claim that no payment was sent.

Three actual-component regressions fail on deployed acaf540b source and pass after the change: automatic Safe pending review, the screenshot's simulation failure, and old saved activity text. Evidence: `/private/tmp/jb-performance-checks/revnet-service-copy-before-ci-env.log` and `revnet-service-copy-focused.log`. The first temporary baseline run omitted CI's `NODE_OPTIONS=--no-experimental-webstorage`; that harness-only failure is preserved in `revnet-service-copy-before.log` and is not the causal comparison. Legacy release/recovery guards continue to pass. Existing assertion changes update only the requested wording, leaving every payment, nonce, signature and recovery assertion in place. The SDK-originated expiry diagnostic remains tested verbatim.

Focused verification passes 564 tests across25 suites (353 boundary/recovery/core cases,135 further callers,76 launch/review/storage cases). Typecheck, lint, formatting ratchet, dead-code, source invariants and all142 wallet-write inventory sites pass under the pinned Node26.5/npm12 toolchain. The literal component-copy gate prevents reintroducing the service name in UI source. No production build, wallet action, push or deployment was performed; root owns combined integration, independent review, hosted full gates and exact-revision release verification.

Independent review corrected two copy-only nits (authorization article and confirmation capitalization). The legacy display formatter also corrects the same article when formatting an old saved authorization message; its focused regression and affected batch/launch suites pass.

Independent source review finds no remaining blocker and confirms unchanged authority, query, transaction and recovery behavior. Final typecheck, lint and formatting checks pass after the copy nits.

Final consolidation on the reviewed source passes all564 affected tests across25 suites in one run, with zero skips or failures. Machine-readable evidence: `/private/tmp/jb-performance-checks/revnet-service-copy-final-tests.json`; companion log has the exact invocation. The final format ratchet initially required reflowing the shortened transaction-review expectation, then passed without changing the assertion.

## 2026-10-07 global-permission response repair

## Plan refinement

- **Objective:** Remove the proven Operator permission-response 502 and accurately display account-wide permission grants without creating project 0 links; preserve the deployed performance/activity behavior.
- **System fit:** The registered query and installed SDK accept global project ID 0, but the shared operation validator rejects it. Change the two permission-list opt-ins at that owner, then keep newly admitted account grants distinct by chain and grantor in OperatedProjects. Transaction authority, query policies, data sources and positive project navigation remain unchanged. Root owns combined integration, hosted gates, deployment and the unchanged exact-revision returning-cache probe.
- **Reuse and simplicity:** Reuse hasDeploymentIdentity/hasIdentityItems with a strict default and explicit unary Array.every callback; reuse current account grouping, labels, EthereumAddress and ProjectLink. Global grants use unlinked All projects labels and one group per grantor. Add no metadata query, dependency, new UI primitive or global validator relaxation.
- **Evidence and unknowns:** Exact production acaf540b returns 502 for three genuine Base v6 projectId0 records while the upstream and SDK accept them; positive project 3 passes the same proxy. The account consumer currently merges grantors into a fake project0 link. Juicebox already accepts the response and its separate pre-existing display issue is outside this patch. The original failed live probe and differential remain in /private/tmp/jb-performance-checks.
- **Verification:** Add failing-before/passing-after tests through actual registered document and operation validators for global grants first/later, malformed identity/scalars, strict ordinary project lists and exact ProjectOperator. Render the actual account component to prove separate grantor permissions/attribution, no global project link, and unchanged positive links. Run focused schema/query/proxy/permission tests, types, lint, formatting ratchet, source and wallet checks; leave full build/browser/hosted release gates to the final combined tree.
- **Resource budget:** One new writer checkout/branch rooted at exact deployed acaf540b; preserve activity8691 and both performance artifacts. Reuse a verified physical copy of the pinned dependency graph and existing test runners. Keep discovery bounded to the demonstrated permission-list family and its newly exposed account consumer; replan for any contradictory scope/authority evidence.

- [x] Add and capture focused fail-before schema and account-rendering regressions.
- [x] Implement narrow permission-list wildcard opt-ins and truthful account grant grouping/display.
- [x] Run focused/static checks and inspect the scoped repair for root integration.

Required resources: /Users/jango/Documents/jb/v6/evm/AGENTS.md, /Users/jango/Documents/jb/v6/evm/workflow/ponytail/SKILL.md, /Users/jango/Documents/jb/v6/evm/workflow/ponytail/README.md, /Users/jango/Documents/jb/v6/evm/docs/PLAN_REFINEMENT.md and relevant root/app tasks/lessons.md. No descendant app AGENTS.md is present. Installed Next16.3.8 use-client and Link documentation was read before app edits. Owning release design: /Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_RELEASE_FOLLOWUPS.md.

### Permission repair verification and handoff

The new checkout is based on exact deployed merge `acaf540b901b565d0ae8b44fb19fc40a8066fc5c`; the qualified activity8691 worktree and build are unchanged. The physical dependency copy matches the verified locked graph byte-for-byte: 113,031 distinct files, 51 internal symlinks, SHA256 `8162a7426287213667b3547570717d2e3cf0a5c4d991e35888ccf937ef6734b3`. Node26.5.0/npm12.0.1 runs the checks.

Before runtime changes, six actual server-contract tests reject valid global grants in both permission lists with status502, covering first/later/all-zero positions; two rendered account cases fail on the missing global label and fake project0 link. The other 13 tests in that batch pass. After the narrow owner changes, all53 focused tests across8 suites pass, including the actual registered SDK document plus application response validator, strict positive identities in ordinary lists and exact ProjectOperator, 14 malformed identity shapes at both list positions, selected-field/nested-shape rejection, global grantor/chain separation, case-insensitive merging within the same scope, grant permissions and attribution, and unchanged positive links. The SDK contract checks selected-field presence/nested shape; this patch does not claim or add address/scalar validation beyond the existing app identity checks.

The existing live schema contract passes3 tests against both published schemas and its real positive-project filter. Dependency integrity, full typecheck, ESLint, the unchanged formatting ratchet, source invariants, wallet-write inventory and `git diff --check` pass. No full build/browser or deployment was run here; root owns full hosted qualification of the final combined tree and exact-revision production verification, including the preserved failing returning-cache journey. Independent review of the scoped diff found no blocker on the returned valid global-grant data; final commit review remains part of root integration.

Evidence under `/private/tmp/jb-performance-checks`: `revnet-permission-before.log`, `revnet-permission-focused.log`, `revnet-permission-live-schema.log`, `revnet-permission-{dependencies,typecheck,lint,format,source,wallet}.log`, and `revnet-permission-physical-provenance.json`. The original production failure and public differential remain preserved separately. No wallet action, push, deployment, local server or browser process was started.

## 2026-10-07 concise funding actions

## Plan refinement

- **Objective:** Make the ready Safe bundle funding action and its nested funding confirmation read exactly “Pay”, as the user requested, while preserving the existing execution and recovery behavior.
- **System fit:** SafeQueueCard owns the ready funding action; the Safe adapter and forwarded-call hook own the shared payment review requests. These pass labels into existing dialog renderers. Root owns integration and release, and separate investigators own the newly reported funded-bundle mismatch/status issue.
- **Reuse and simplicity:** Change only the three existing label literals and the existing exact button/payment-review assertions; add no UI layer, handler, state rule or shared abstraction for a single word.
- **Evidence and unknowns:** Clean f9244fd5 includes the previously reviewed copy and permission integration. The request is an explicit label correction; the new funding/status failure has no demonstrated cause in this patch and is outside its scope.
- **Verification:** Run the existing Safe queue preparation/payment/recovery tests and actual shared payment-review hook tests, retaining every enabled/disabled, wallet, nonce and recovery assertion; check types, lint and formatting.
- **Resource budget:** One writer, three literal changes and focused existing tests. No build, quote request, wallet action, push or deployment; hand the clean scoped commit to root.

- [x] Update the ready funding and nested payment labels to Pay.
- [x] Qualify the existing payment/recovery tests and static checks; hand off the scoped commit.

### Pay-label verification

Only the ready Safe bundle action and the two existing funding-review `confirmLabel` literals changed in runtime source. The review renderer already respects the request label; these payment calls do not enable the separate protocol-fee review override. Existing exact selectors now require Pay, and both the Safe and forwarded payment hook assertions require `confirmLabel: "Pay"`. All readiness, funding-selection, disabled-state, recovery, nonce, wallet and receipt checks remain.

All261 focused tests across5 suites pass, covering Safe queue rendering, payment/recovery hooks, legacy adaptation and the actual review provider. Typecheck, lint, formatting ratchet, wallet-write inventory and `git diff --check` pass. Reports: `/private/tmp/jb-performance-checks/revnet-pay-label-tests.json` with its invocation log, and `revnet-pay-label-static.json` with hashed gate logs. No build, push, deployment, quote request or wallet transaction was performed. The separate reported paid-bundle mismatch/progress issue is unchanged by this label-only patch and remains with its investigators.

## 2026-10-07 eliminate repeated reads within one precondition check

## Plan refinement

- **Objective:** Remove demonstrated duplicate Safe nonce/hash reads within each validation pass, retaining fresh review-to-send checks and protection for old saved quotes.
- **System fit:** `safeRelayrExecution` saves mandatory guards alongside requested guards, and adapter revalidation synthesizes mandatory guards again for legacy compatibility. Existing `verifyCallPreconditions` owns live snapshot comparisons for Safe, raw/forwarded and direct batch paths. Deduplicate at that read owner only; journal evidence, simulation, authority, final checks and payment/recovery behavior stay intact. Root owns shared SDK progress/funding fixes and release integration.
- **Reuse and simplicity:** Add an invocation-local set in the existing verifier keyed by case-insensitive address, calldata and expected bytes. Read each identical tuple once; preserve different expectations, all distinct calls, original input and mandatory legacy guard synthesis. No helper, dependency, cross-pass cache or caller-specific rule.
- **Evidence and unknowns:** Clean238b6343 and installed SDK2.24.4 demonstrate two stored Safe guards plus the same two synthesized guards in a single pass. Root approved the generic owner and requires independent caller coverage. The separate wrapped-payment proof and payment-checking phase remain outside this commit until their qualified SDK artifact is available.
- **Verification:** Capture failing-before duplicate read counts, then run guard, Safe adapter/payment/recovery hook and independent batch regressions. Cover mixed-case equivalents, retained conflicting expectations, rereads on later passes, legacy journals without saved guards and state drift after payment review with no wallet send. Run typecheck, lint, formatting, source and wallet-write checks plus diff review.
- **Resource budget:** One writer in this isolated tree, bounded existing fixtures and static gates; no remote quote, wallet action, production build, push or deployment. Commit separately atop238b6343 and report exact evidence to root; replan if the change needs a broader lifecycle or persistence rule.

- [x] Add and capture failing-before read-count and safety regressions.
- [x] Deduplicate equivalent preconditions within the existing verification invocation.
- [x] Run focused/static checks and review the scoped diff for handoff.

Required resources remain the absolute root AGENTS.md, workflow/ponytail/SKILL.md and README.md, docs/PLAN_REFINEMENT.md, relevant root/app lessons and docs/WEBSITE_PERFORMANCE_RELEASE_FOLLOWUPS.md. No descendant AGENTS.md is present in this checkout.

### Precondition read verification

The before-change run fails exactly four new read-count assertions: the Safe adapter reads each nonce/hash twice, raw source checks read equivalent guards twice per pass, direct batch checks read duplicates eight times across four passes, and the generic verifier repeats mixed-case equivalents. The other243 cases pass, including retained conflicting expectations and reconstructed legacy nonce/hash guards after payment review. The five-line runtime change makes all318 cases across six guard, batch, hook, Safe adapter and queue suites pass. Tests also prove fresh reads on later invocations, unchanged saved guards, distinct address/calldata reads, and no wallet send after final drift.

Typecheck, lint, formatting ratchet, wallet-write inventory, source checks, dead-code checks and `git diff --check` pass. Before/after JSON, invocation logs and the hashed static manifest are `/private/tmp/jb-performance-checks/revnet-precondition-dedup-{before,tests,static}.json` with associated logs. The only runtime change is the local exact-tuple set in `verifyCallPreconditions`; no lifecycle, persistence, final authority, simulation, payment or recovery policy changed. Root's independent reviewer owns final pinned approval and integration. No SDK adoption, build, remote quote, wallet action, push or deployment occurred here.

## 2026-10-07 final payment checks and submitted progress

## Plan refinement

- **Objective:** Show the actual final Safe validation phase and stop describing submitted or ambiguous funding as waiting for payment; verify automatic per-chain progress with the shared wrapped-payment proof.
- **System fit:** The SDK owns payment proof, beforeSend, stored funding evidence and destination recovery/watch. The existing Safe adapter supplies full clients and unchanged final guards; SafeQueueCard maps SDK phases and rows into product copy. Adopt the qualified preview only in this checkout's installed core package, then exercise the actual adapter/controller, existing hooks and rendered queue. Root owns official SDK publication, final dependency pin and release qualification.
- **Reuse and simplicity:** Extend the current exhaustive phase map with payment-checking and reuse the existing progress/session and recovery evidence for row labels. Use the SDK's receipt proof and existing watch path; add no parser, polling loop, cached authority, journal rewrite or independent lifecycle. Preserve Pay and the approved per-invocation guard dedup.
- **Evidence and unknowns:** Preview365ebd65cd4c1ffb96d026f07cc45936c40419d7 tarball SHA256a137b8db853940e931988f1d67780bfcc912d2c9c0d8f9215a419c9558201856 is still version2.24.4 and is not a release. Current43ad4295 shows Waiting for payment during payment-confirming; the SDK adds payment-checking at beforeSend. Root resolved the adapter timing boundary without changing guard order: payment-review spans nested review plus runtime authentication/simulation and says Preparing payment; payment-checking says Checking before payment during beforeSend. The nested review retains its explicit Pay action.
- **Verification:** Record package provenance and unchanged manifests/lock. Add deferred actual-adapter review-to-beforeSend checks, no premature wallet send, submission evidence, wrapped funding verification and delayed independent destination progress/recovery. Render checking/submitted/ambiguous states without another Pay action, retaining rejection/failure protections. Run focused financial/queue tests and types, lint, formatting, source, wallet and dead-code gates; qualify again against the official pin before any build/release.
- **Resource budget:** One app writer, one SDK-only preview staging operation without dependency resolution, bounded existing fixtures and no live quote or wallet calls. Reuse SDK evidence and coordinate wording with Juicebox. No Next build, lock change, push or deployment until root supplies the published artifact; replan if UI accuracy needs another SDK lifecycle contract.

- [x] Stage the exact SDK preview locally and record immutable provenance.
- [x] Extend phase/submitted presentation and actual adapter/recovery regressions.
- [x] Qualify focused/static checks and prepare source for official SDK adoption.

### SDK preview and progress verification

The exact preview tarball was staged by replacing only this checkout's physical core package, retaining its original bytes at `/private/tmp/revnet-sdk-original-43ad4295`. No resolver ran; package.json, package-lock.json and node_modules/.package-lock.json hashes are unchanged. `/private/tmp/jb-performance-checks/revnet-safe-payment-preview-provenance.json` records the source365ebd65, tarball hash and754 installed-file tree. This is still an unpublished version2.24.4 preview, and these checks do not qualify a clean install, official dependency pin, build or deployment.

Runtime edits are confined to SafeQueueCard's existing display mapping. Preparing payment spans nested consent plus unchanged local preparation; Checking before payment identifies SDK beforeSend. Submitted/ambiguous funding shows Checking payment status until the SDK supplies execution evidence. The initial funding and nested confirmation remain Pay; payment/guard/proof/watch owners are unchanged.

The rendered before-change regression fails on stale payment-review copy (180 other cases pass). After the presentation change, all349 tests across7 focused suites pass. The actual adapter/controller regression holds nested Pay review, runtime authentication, both chains' final nonce checks, wallet response and receipt in turn, requiring their true SDK phases and no premature send. Its synthetic wrapped payment changes outer target/data/value/sender and is accepted only through the SDK's canonical event plus historical runtime proof. One destination remains unavailable while the other verifies; reopening recovery retains progress, the final watch completes both and the wallet is called once. The SDK owner separately retains the user's actual wrapped-transaction fixture and invalid-proof matrix.

Typecheck, lint, formatting ratchet, wallet-write inventory, source checks, dead-code checks and `git diff --check` pass. Evidence is `/private/tmp/jb-performance-checks/revnet-safe-payment-preview-{before,tests,static}.json` with invocation/gate logs and immutable package provenance. Root must supply the published core pin and independently qualify the resulting dependency graph and final app before build/release. No live quote, signature, wallet transaction, build, push or deployment was performed.

## 2026-10-07 single preview bundle diagnostic

## Plan refinement

- **Objective:** Use the root-granted sole local build slot for one diagnostic build of reviewed54d47ca2 with SDK365ebd65 preview bytes, detecting bundle/lazy-loading regressions before official release qualification.
- **System fit:** Reuse the existing deterministic browser-build script, standalone check and client budget/lazy-wallet gate; these inspect the compiled product without starting a browser or authorizing transactions. Root owns SDK publication, official dependency adoption and full hosted build/release gates.
- **Reuse and simplicity:** Keep the verified physical dependency layout and pinned Node26.5.0/npm12.0.1, with only the recorded SDK preview replacement. There is no prior .next in this checkout to overwrite. Read the qualified8691 activity checkout's existing build-TfctsWXpff2fKS artifact as the baseline, leaving its source/artifact and prior2bd archive unchanged. Reuse the existing bundle measurement helper; change no budgets or application source.
- **Evidence and unknowns:** The latest qualified baseline has2,666.7KiB aggregate,935.0KiB route-referenced and689.6KiB largest route with the same physical lock graph and fixture script. Its existing manifest is revnet-hydration-artifact.json. The comparison includes service-neutral copy, permission repair, Pay, guard dedup, progress and SDK changes; it cannot isolate SDK cost or prove official build size. Current preview provenance remains explicit and package manifests/lock unchanged.
- **Verification:** Confirm baseline artifact identity, SDK preview hash, clean application inputs and toolchain; run exactly one build:browser then standalone:check and unchanged bundle:check. Record exact byte totals, route sizes, lazy-wallet results, source/artifact/provenance hashes and comparison limits. Preserve failure output and replan for a real failure; no automatic cap increase.
- **Resource budget:** One sequential build and bounded read-only measurements, no browser, resolver, live quote, wallet action or deployment. Preserve the diagnostic artifact for official-pin comparison and release the local build slot promptly; official npm adoption and final hosted qualification remain required regardless of this result.

- [x] Run the single preview production build and owning artifact gates.
- [x] Record the qualified-baseline comparison and return the quiet build slot to root.

### Diagnostic build result

One actual Next16.3.8/webpack build passes with the existing deterministic fixture; an earlier sandbox attempt stopped at local-listen EPERM before Next started and is retained separately. Standalone checks and unchanged bundle/lazy-wallet gates pass. Aggregate client JavaScript is2,733,775 bytes gzip (2,669.7KiB;305 bytes below cap), route-referenced JavaScript961,153 bytes, and largest operator route707,634 bytes (691.0KiB). WalletConnect, Coinbase and Safe remain lazy; emitted client chunks stay210. No cap or source change was needed.

The qualified8691 baseline is2,730,720 aggregate bytes, so the complete subsequent copy/permission/Pay/dedup/progress/SDK change is+3,055 bytes; this does not isolate SDK cost. Baseline/home/project/operator/create sizes were measured from each existing artifact using the same owning algorithm, unchanged caps, physical dependencies and identical deterministic fixture script/input. All3,352 baseline artifact files match their prior manifest. The diagnostic's3,035 files were cloned and verified byte-for-byte at `/private/tmp/jb-performance-tools-20261007/revnet-safe-payment-preview-54d47ca2-preserved/.next`; the baseline includes its prior browser staging, which this diagnostic does not repeat. The deterministic build ID is shared across these fixture builds and does not identify a revision; source and SDK manifests provide attribution.

Evidence: `/private/tmp/jb-performance-checks/revnet-safe-payment-preview-build-diagnostic.json`, `revnet-safe-payment-preview-artifact.json` and build/standalone/bundle/measurement logs. Root's build slot was returned after build/fixture processes ended. No browser, resolver, manifest/lock edit, production transaction or deployment occurred. The official SDK pin and final hosted build remain required; the small measured aggregate headroom makes that exact artifact's gate decisive.

## 2026-10-07 official core adoption preparation and graph correction

## Plan refinement

- **Objective:** Prepare the exact official core2.24.5 adoption while awaiting root's registry integrity signal, and correct the demonstrated preview dependency-layout mistake without changing application source or budgets.
- **System fit:** The preview staging moved the installed core directory, including its nested bs58/base-x dependencies, into the preserved backup. Its replacement tarball contains package files only, so imports resolved to incompatible root major versions. Restore only those preserved nested bytes; official adoption will replace verified core package files while retaining the locked dependency graph. Root owns publication verification, PR74 and decisive hosted npm-ci/full test/build/browser gates.
- **Reuse and simplicity:** Reuse the original core backup and existing package lock, installed package graph and checksum tooling. Inventory every installed path/content before and after restoration and compare with the qualified physical baseline, distinguishing only verified core package changes. Pin only the core exact version, lock-root version and registry version/resolved/integrity fields after the official signal; no general resolver, transitive update or new logic.
- **Evidence and unknowns:** Core's preserved nested bs58 is5.0.0 and its base-x dependency is4.x; the preview installation lacks both and resolves root bs58 6.0.0/base-x5.x. The previous manifest-only checks missed this. Preserve all preview reports/artifacts but invalidate their locked-graph bundle comparison and305-byte headroom claim. The official release is not yet authorized for fetching/pinning here, and its753 compiled/package-support files must be compared before reusing scoped source evidence.
- **Verification:** Capture before/after whole-graph files, symlinks, package versions, dependency resolution and unchanged manifests; restore only the missing nested graph from the retained original package. At official adoption, verify registry/tarball integrity, all official package files and metadata, unchanged dependency graph excluding only official core replacement, exact lock diff, dependency check, typecheck and formatting/diff gates. Reuse preview tests only where compiled bytes and restored dependency evidence justify it; final hosted npm-ci, full tests/build/budget remain required.
- **Resource budget:** No new local build or repeated preview suite; root explicitly made hosted clean-install qualification decisive after this finding. One bounded full-graph inventory/restoration and a narrow official pin after the root signal; preserve every immutable archive. Stop and report any unrelated graph discrepancy rather than silently resolving or changing dependencies.

- [x] Capture the missing nested dependency graph and restore its exact preserved bytes.
- [x] Wait for root's official registry integrity evidence before package adoption.
- [x] Apply the narrow official pin, verify package/graph/static checks and hand off to root.

The prior preview build's size/graph comparison is invalidated by this finding. Its archive and reports remain historical evidence, not locked-dependency release qualification.

Restoration evidence: `/private/tmp/jb-performance-checks/revnet-sdk-nested-restore.json` links complete113,075-path before,113,084-path qualified-baseline and113,086-path after inventories. Exactly11 missing nested dependency files were restored from the original backup, with no other restoration change. Deep npm traversal failed beforehand on SDK resolution to invalid bs58 6.0.0/base-x5.0.1; it now passes with nested bs58 5.0.0/base-x4.0.1. Every other installed package path/content matches the qualified baseline apart from16 expected core preview files. Three explicitly listed non-package differences are generated jiti configuration caches and Vitest results; none was removed or silently treated as a package change.

Final adoption will require official package integrity and all753 non-metadata files to match the reviewed preview, retain the restored nested graph, and verify the complete package-path/content differential. Narrow local gates are dependency integrity, explicit deep SDK dependency resolution, typecheck, formatting and diff/lock-scope checks. The prior focused/static passes describe the former staged graph only; no new local build or repeat suite is authorized. Hosted clean-install full CI owns the final tests and compiled artifact.

## 2026-10-07 verified official core2.24.5 adoption

## Plan refinement

- **Objective:** Adopt root's verified official core2.24.5 with an exact pin and unchanged application source, budgets and restored dependency graph.
- **System fit:** The shared SDK owns payment proof and lifecycle; the already reviewed app consumes its unchanged753 compiled/support files. Root supplied official release evidence and owns PR74 plus final hosted clean-install tests/build/budget/browser qualification. This metadata adoption does not create payment or deployment authority.
- **Reuse and simplicity:** Compare the official tarball against the current installed core, then write only its package.json bytes when every other package file already matches. Update only the exact application/root-lock pin and core version/resolved/integrity fields in tracked and installed locks; retain nested node_modules and every transitive package path/content. Run no resolver.
- **Evidence and unknowns:** Official gitHead3a0c1561bb80dc8db6702698b3ab0cdb2d9a0b59 and tarball SHA256a8a1fb5501aab4c028129c4c393774cfff41d3f356ac931db453f13a7999adcc are authorized by root with matching registry SHA512 integrity. The restored graph evidence is revnet-sdk-nested-restore.json; the former preview build and tests remain qualified only for their incorrect staged graph, not release evidence.
- **Verification:** Verify all754 official package files, whole installed path/content inventories before and after, retained nested bs58 5.0.0/base-x4.0.1 resolution, and an exact metadata-only lock delta. Run dependency check, deep SDK npm traversal, typecheck, formatting and diff checks; report immutable evidence and clean commit for independent review. Final hosted clean-install full CI remains decisive.
- **Resource budget:** One narrow metadata adoption and bounded static gates, no repeated preview tests, source or cap changes, local build, browser, live quote or wallet action. Preserve every archive and prior report. Stop and replan on any unrelated graph change; root handles push and release.

- [x] Receive and verify root's official registry integrity signal.
- [x] Apply the exact official pin while retaining the complete restored graph.
- [x] Verify metadata, graph and static checks; commit the scoped handoff for root.

### Official adoption verification

The official tarball matches the registry SHA1/SHA512 and root's SHA256, version2.24.5 and gitHead3a0c1561. All753 compiled/support files already match the installed reviewed preview, so only the exact official core package.json bytes were written. The application pin, root-lock pin and core lock version/resolved/integrity fields are the only tracked dependency changes; the installed hidden lock has the same three-field update. No resolver ran and no transitive lock entry changed.

The whole installed graph before adoption exactly matches the restored113,086-path inventory. Its after inventory retains every path, file and symlink, with differences confined to core package.json and the installed hidden lock. All754 official package files match the tarball. Direct Node resolution and deep npm traversal confirm the retained SDK-local bs58 5.0.0/base-x4.0.1. Dependency integrity, deep SDK dependency traversal, typecheck, formatting ratchet, refinement and diff checks pass with pinned Node26.5.0/npm12.0.1; application, test, script and budget source remain identical to reviewed54d47ca2.

Immutable evidence is `/private/tmp/jb-performance-checks/revnet-sdk-official-adoption-integrity.json` with before/after full graph inventories, original metadata snapshots, official file hashes and explicit structural metadata diffs. Gate logs, actual resolved paths and the final commit manifest use the same prefix, ending in `-verification.json` for the handoff manifest. Independent review and root-owned PR74 promotion follow. The invalid preview build and former staged-graph tests are preserved with their correction; this adoption ran no repeated suite, local build, browser, remote quote or wallet action. Final hosted clean-install full tests/build/budget/browser gates still qualify release behavior and size.

## 2026-10-08 official-graph aggregate budget investigation

## Plan refinement

- **Objective:** Explain the final hosted aggregate bundle failure at2670.4 KiB against2670 and propose the smallest measured correction while preserving the payment and performance fixes.
- **System fit:** Hosted CI37710473620 passed all preceding source, unit, audit, production build and standalone checks, plus the separate OCI job; route budgets and lazy wallet boundaries pass. Reuse the exact33b66876 application with verified official core2.24.5 and the restored physical dependency graph. Root owns any approved correction and final hosted release qualification.
- **Reuse and simplicity:** Use one existing build:browser invocation, bundle/standalone gates, artifact hashing, bundle measurement and Acorn module inspector. Verify the current preview has its immutable matching archive before overwrite; compare the new artifact to the qualified activity baseline with matching physical package layout. Add no bundler instrumentation, dependency, source refactor or cap change before the causal evidence is reviewed.
- **Evidence and unknowns:** The failed hosted log is revnet-payment-progress-ci-37710473620-failed.log. The earlier preview omitted nested dependencies and remains invalid for attribution. Qualified activity aggregate is2,730,720 bytes with210 chunks; the complete subsequent copy, permission, guard, progress and SDK changes may affect module placement, so per-chunk evidence must bound claims about individual causes. Local and hosted environment differences must remain explicit.
- **Verification:** Verify preserved artifacts and the complete official package graph; run one pinned Node26.5.0/npm12.0.1 production fixture build and unchanged standalone/budget gates. Archive/hash the result, compare route/chunk/module totals and import placement against the qualified baseline, and send independent review evidence before proposing a minimal reduction or narrowly rounded aggregate limit. Final hosted full CI must pass after any accepted correction.
- **Resource budget:** Root grants this sole sequential local build slot; no browser, repeated full unit suite, resolver, remote quote or wallet action. Keep the invalid preview and every qualified archive untouched. Stop and replan if the measured difference exceeds known source/dependency scope or changes lazy boundaries; release the build slot as soon as the single build ends.

- [x] Verify official graph and archive identity before the single build.
- [x] Build once and compare exact artifact/chunk/module measurements.
- [x] Hand measured correction proposal to root and independent reviewer.

### Official-graph measurement

The single authorized production build and standalone check pass. The unchanged aggregate gate reproduces the failure at2,734,565 bytes (2670.5 KiB),485 bytes over2670 KiB; all route budgets and wallet vendor lazy-loading boundaries pass. The qualified matching-fixture activity artifact is2,730,720 bytes, so the complete reviewed app/SDK change adds3,845 bytes (0.14%). Hosted CI reports2670.4 KiB with additional deterministic public RPC/subgraph/Dwellir inputs; local and hosted artifacts are not claimed byte-identical.

Acorn extraction pairs every1,872 unique module across31 generated ID renames. All2,365 emitted copies, every210 chunk's mapped module set and all33 shipped client-reference manifests remain equivalent; the two browser-only proof routes stay excluded by the existing budget. The ten existing chunks containing utils collectively grow3,162 bytes, shared review chunk9203 grows551 bytes, and all other chunks net132 bytes. The shared review was already initially referenced in both artifacts; its proof and lifecycle retain one copy each. Whole-chunk deltas include app copy/permission and generated hash/minifier differences, so standalone module gzip diagnostics are not additive feature savings.

The original invalid preview/archive and qualified baseline retain all verified hashes. The new official3,035-file artifact is preserved at `/private/tmp/jb-performance-tools-20261007/revnet-safe-payment-official-33b66876-preserved/.next`. `/private/tmp/jb-performance-checks/revnet-official-budget-analysis.json` links inputs, graph, artifact, chunk/module/route evidence and original failure logs. Root and the independent reviewer received the proposal to round only2670→2671 KiB, leaving539 bytes of measured headroom and every route/lazy boundary unchanged. No cap or source change has been applied; a speculative formatter split would require another build without a demonstrated loading benefit. The build slot has been returned, and final hosted full CI remains required after an accepted correction.

## Plan refinement

- **Objective:** Apply the independently approved minimum aggregate budget adjustment2670→2671 KiB and hand off a clean correction for hosted CI.
- **System fit:** Only the existing bundle gate's aggregate threshold and evidence comment change; runtime, payment authority/recovery, route limits and lazy-wallet checks remain unchanged. Root owns final hosted qualification and release.
- **Reuse and simplicity:** Reuse the already-built verified official artifact and current gate; no rebuild, dependency change, source refactor or new test.
- **Evidence and unknowns:** Root and the independent reviewer approve analysis1166147c88206f7e3c14599f29144443616609d7ab045630ada410fd65ea1eb6 after independent artifact/module/route verification. Measured excess is485 bytes and the one-KiB rounding leaves539 bytes; final hosted evidence remains required.
- **Verification:** Run the owning bundle gate on the same official artifact, preserving the original failed log; run formatting and diff checks, assert all non-aggregate checks unchanged, then commit only the budget script and task notes for exact-head review.
- **Resource budget:** One threshold/comment edit and bounded existing artifact/static checks. No second build, browser, full unit suite or production action; send the clean head immediately for root's hosted CI.

- [x] Apply the approved aggregate threshold/comment and qualify the unchanged artifact.
- [x] Commit the scoped correction and report its exact source/evidence to root.

### Approved correction result

The aggregate threshold is2671 KiB with a three-line measured comment. An exact text comparison proves these are the bundle script's only changes:900 KiB per-route and1100 KiB route-referenced limits, asset counting/exclusions and all lazy-wallet assertions are unchanged. The owning bundle check now passes on the same official artifact at2,734,565 bytes; formatting and diff checks pass. No rebuild or repeated unit suite occurred. The original failed gate and invalid preview evidence remain intact. `/private/tmp/jb-performance-checks/revnet-official-budget-correction-verification.json` pins the scoped commit, approved analysis, artifact and successful gate/scope logs for independent exact-head review and root's final hosted CI.

## 2026-10-08 — Shared client RPC and Safe execution owners

- [x] Replace duplicated RPC pacing with the shared SDK export.
- [x] Replace matching Safe execution rules with SDK calls while preserving each caller's accepted transaction shapes.
- [x] Run existing RPC, Safe proof and caller regressions plus source/lint/type gates; record exact preview and remaining root-owned qualification.

## Plan refinement

- **Objective:** Make Juicebox and Revnet consume the same SDK-owned request pacing and exact reviewed Safe execution proof as the other clients, preserving existing visible behavior, journal schema, wallet guards and recovery policy.
- **System fit:** App display/transaction flows retain their React/wagmi adapters and journals; SDK owns request-start pacing, exact reviewed calls and receipt execution evidence. Fresh wallet authority, submission and durable recovery retain their existing owners. Root coordinates the four-client architecture inventory, package staging and final build/browser verification.
- **Reuse and simplicity:** The two RPC implementations are identical apart from formatting. Extracted SDK exports replace the duplicated implementations through their existing app paths. Safe execution extraction reuses existing SDK decoding and receipt owners; Revnet's explicit single-call versus batch policy remains a required argument in its local wrapper. Pending-proposal timing and stamped-call policies differ and stay local.
- **Evidence and unknowns:** Baselines are the latest refreshed Juicebox 6a0598d and Revnet 1fcbf1f1. Existing tests cover 125ms pacing, aborts, 429 cooldown, canonical MultiSend deployments, exact order/value/data, immediate execution and strict single-call rejection. SDK exports are being implemented in the sibling isolated checkout and are unverified until its qualified package is staged. Installed Next 16.3.8 client-boundary/Vitest docs were read from the existing Juicebox checkout while clean physical dependencies are prepared here.
- **Verification:** Preserve and run existing RPC/Safe tests and the full affected transaction callers; source gates require the new shared owners. Run lint, types, source invariants, transaction/write-site checks and whitespace. Root owns exact preview staging with nested dependencies preserved, full suite/coverage, serialized production builds and browser journeys; no publication or deployment is part of this change.
- **Resource budget:** One writer owns both small caller migrations; the SDK agent owns extraction/tests, root owns installation and release gates. Reuse existing regressions rather than duplicate SDK unit suites. Replan before changing any acceptance set, recovery behavior or package graph.

Refinement extension: transaction wording also shares the SDK review owner under `../sdk-client-reconciliation/tasks/transaction-message-plan.md`; the two current formatters differ, so first extract Revnet unchanged, then reconcile Juicebox's demonstrated presentation cases while preserving URL/identifier protection, diagnostics and all recovery warnings. JBM pending lookup/stamp/polling helpers move unchanged to the SDK because Sticky/Homerun adopt that exact policy; Revnet keeps its different lifecycle.

## Plan refinement

- **Objective:** Finish the shared SDK caller migration and fix the reproduced browser RPC queue timeout: queued requests must wait through a server-directed cooldown before their transport timeout starts, while independent requests remain paced and overlap.
- **System fit:** SDK provider admission now owns both 125ms request-start spacing and Retry-After cooldown before request timeout creation. App transports provide one browser limiter across chains and a correctly bound window fetch. Server transport, pinned-block retry, wallet authorization, execution proof and journals retain their existing owners.
- **Reuse and simplicity:** Replace the first-phase fetch re-export with the existing provider limiter extension createPacedJBCenterLimiter. Remove obsolete app fetch wrappers and their moved SDK unit tests; preserve actual transport integration tests and add long-cooldown/concurrency acceptance there. Safe and formatter migrations follow the earlier checked refinement unchanged.
- **Evidence and unknowns:** SDK investigation reproduced that fetch-level queuing begins after provider timeout creation and duplicates the provider response-slot limiter. Root approved moving pacing into SDK admission. Source extraction equivalence was verified first; this second phase intentionally fixes only admission timing, response concurrency and shared cooldown ownership. Final preview qualification remains pending SDK owner gates.
- **Verification:** Actual viem transport tests must prove twelve unresolved requests can start 125ms apart, a 60-second Retry-After wait does not expire the 15-second request timeout, server origin and browser fetch receiver remain correct, and pinned-block retries still pass. Existing Safe proof, explicit non-batch rejection, error evidence and source gates remain required, followed by root-owned full builds/browser checks.
- **Resource budget:** One limiter per browser module, no extra scheduler or dependency. SDK unit tests own abort and timer details; app integration tests own provider placement. Root stages the exact package into physical locked installs. Replan on changed server behavior, unreliable fake-time results, or any authority/recovery change.

Reconciliation review in progress: qualified preview2 was installed with exact Node26.5/npm12, then a clean physical npm ci. The SDK owns provider pacing, transaction presentation and Safe transaction/execution matching; the adapter always passes Revnet's explicit batch policy, including its strict single-call rejection regression. The affected RPC/Safe/error suites passed36 cases. The reviewed-write boundary and durable pre-wallet-abort cleanup owner reports197 hook/batch cases plus types passing; its detailed refinement is tasks/reviewed-write-reconciliation.md. All10 local static gates passed (dependencies, dead-code, environment, deployment, types, lint, format ratchet, source, protocol fixture and wallet inventory), recorded in /private/tmp/rnm-client-static-results.json.

The first bounded full coverage run is preserved at /private/tmp/rnm-client-reconciliation-coverage.log; the sandbox refused its existing live schema/RPC checks. The run was explicitly stopped with exit130 before newly authorized final-wallet guard edits began. It is incomplete evidence, not a full-suite pass. Root assigned the remaining Safe batch, payment and signing boundaries to separate owners; final full coverage must run with authorized network access after those fixes and official SDK adoption, followed by serialized production/browser qualification. No app release or deployment has occurred.

## Plan refinement

- **Objective:** Align Revnet's pinned wallet and server runtime with the other three clients so the reconciled financial adapters execute on the same exact versions.
- **System fit:** Use Node26.7.0/npm12.0.1, wagmi3.7.6 and viem2.55.19 already qualified by sibling clients. The SDK remains the frozen2.25.0 candidate. Root owns official publication and final build/browser qualification; existing Node Web Storage disabling and container restrictions remain enforced.
- **Reuse and simplicity:** Update only the three exact runtime pins and Node's existing .nvmrc/engine/digest/checker/documentation owners. CI already reads .nvmrc. Copy the sibling's immutable Node26.7 container digest; keep historical budget measurement comments intact and do not upgrade unrelated packages.
- **Evidence and unknowns:** Census confirms Revnet alone remains on Node26.5/wagmi3.7.4/viem2.55.8; its runtime ADR gives no application-specific compatibility reason for the older versions. Root explicitly authorized parity before final qualification. Previous26.5 focused results remain diagnostic only; final gates use26.7.
- **Verification:** Install exact wallet versions with npm12, inspect lock changes and perform physical npm ci. Run dependency tree, deployment policy, types/lint/format/source/inventory, complete coverage with authorized live read access and serialized production/browser gates on the final graph. Preserve any first failure and identify intentional runtime differences in artifact comparisons.
- **Resource budget:** All Revnet readers are paused during mutation; one owner controls manifest/lock/runtime pins. No unrelated dependency upgrade, script execution, image publication or deployment. Replan on a concrete runtime incompatibility or unexpected lock churn.

Release-candidate verification: the final SDK2.25.0 preview4 (sha512-DeJMW245XZq1QUs+0zzgE8E8ETah+s+D7QxJoh0KG5uTzyrQh3Jn3EWDRh69f/hi6mTOBCMR1txt8TWUf0RoMA==) was installed with npm12 and physical npm ci. Revnet now pins the sibling Node26.7.0/npm12.0.1/wagmi3.7.6/viem2.55.19 runtime. Only the SDK, wallet packages and their necessary ox/connectors/abitype resolution changed in the dependency graph; all1015 packages were reified physically. Docker uses the sibling's immutable Node26.7 digest, its policy gate agrees, and both CI workflows already read .nvmrc. Historical26.5 budget evidence remains unchanged.

The final10 focused wallet/journal suites passed577 cases. The full authorized-network coverage run passed257 files and2622 cases, with only the pre-existing optional native-direct-pay live case skipped because its dedicated RPC URL is unset. All coverage floors passed: statements66.83%, branches61.16%, functions64.46%, lines68.95%. Existing live schema/RPC contract cases passed. All11 final static/audit gates passed, including dependency tree, dead-code, environment/deployment, native types, full lint, formatting ratchet, source/protocol/inventory and production audit. No assertions, timeouts, retries, coverage floors or audit exceptions were weakened. Evidence: /private/tmp/rnm-client-final-coverage.log and /private/tmp/rnm-client-final-static-results.json.

Root owns comparison of every official SDK payload file to this frozen candidate, registry pin adoption and final production-build/budget/browser qualification. Those gates remain outstanding; this record claims only the completed source and release-candidate checks.

## Plan refinement

- **Objective:** Ship the completed shared-client reconciliation against published SDK2.25.0 through reviewable pull requests with final production and browser evidence.
- **System fit:** The registry package owns the tested shared protocol helpers; app adapters retain wallet context, product journals and rendering. Root verified official payload identity and owns merge after hosted CI. This step changes package provenance and current ownership documentation, not runtime behavior.
- **Reuse and simplicity:** Adopt the exact registry version using the existing npm12 lockfile workflow and physical clean installs. Reuse release-candidate unit coverage because every published payload file and the tarball integrity match; use existing hosted build, budget, browser and container gates without adding a second workflow.
- **Evidence and unknowns:** Root verified all762 published files and integrity sha512-DeJMW245XZq1QUs+0zzgE8E8ETah+s+D7QxJoh0KG5uTzyrQh3Jn3EWDRh69f/hi6mTOBCMR1txt8TWUf0RoMA== against the fully tested candidate. Final hosted production/browser results are still unknown; source is frozen except fixes required by those gates.
- **Verification:** Perform npm install of exact2.25.0 and physical npm ci, confirm registry resolution/integrity, rerun dependency, source, type and documentation-sensitive inventory checks, then require all hosted CI jobs on the exact pushed revision. Preserve first failures and fix their causes without weakening gates.
- **Resource budget:** One owner mutates each dependency graph sequentially. Do not repeat identical full unit coverage; hosted CI runs final heavy gates while sibling local builds are serialized. Commit only inventoried reconciliation files, open both PRs and replan for any payload mismatch or unexpected dependency drift.

Official adoption complete: exact registry SDK2.25.0 is pinned in the manifest and lockfile, with the verified published integrity above. A clean physical npm ci reified all1015 packages with pinned Node26.7.0/npm12.0.1. Registry resolution and installed version match, and final dependency, type, source and wallet-inventory gates pass; deployment/container policy also passes (plus Revnet formatting ratchet). Logs: /private/tmp/rnm-client-official-static-results.json. Current TESTING ownership documentation names the published shared owners. Full unit/coverage evidence above remains valid because the official package is byte-identical to the tested candidate; no full rerun was needed. Pull-request CI now owns final production-build, budgets, browser and OCI smoke evidence before root merges; these gates are not yet reported as passed.

## Plan refinement

- **Objective:** Complete hosted production/browser qualification by accounting for the measured bundle cost of the required shared rules and runtime alignment.
- **System fit:** CI37724379135 passed static gates,2622 unit cases, production build, standalone checks and OCI smoke, then refused aggregate2683.0KiB against2671KiB. The owning bundle policy records accepted application cost;900KiB route,1100KiB referenced-total and all lazy-wallet requirements remain unchanged.
- **Reuse and simplicity:** Keep the existing aggregate checker and adjust only its ceiling to2684KiB, the smallest whole-KiB bound safely above the reported measurement. No runtime code, additional dependency, chunk boundary or financial rule changes.
- **Evidence and unknowns:** MainCI37713095651 measured2670.4KiB on Node26.5 versus candidate2683.0KiB on26.7; both used physical locked installs and npm12. Independent import review found no eager wallet/barrel regression and identified expanded reachable viem public actions plus required guard/recovery code. The difference includes intentional runtime alignment; it is not an exact causal allocation. First failed job/log and prior baseline are preserved.
- **Verification:** Preserve all route/reference/lazy constraints, check source, formatting, lint and whitespace, then require new hosted CI on the pushed revision including previously skipped browser tests. Independent review and root accepted this narrow measured policy adjustment; no test assertion, retry or coverage threshold changes.
- **Resource budget:** Reuse completed hosted measurements and source review; do not run another build pair solely to overattribute a13KiB ceiling change. One budget owner and existing documentation record suffice; replan only if new CI identifies another cost or functional failure.

Independent review confirmed the2684KiB aggregate ceiling with unchanged900KiB route,1100KiB referenced and lazy-wallet assertions. Source invariants, formatting ratchet, scoped ESLint and whitespace checks pass. First hosted failure and baseline logs remain /private/tmp/revnet-pr75-92e58f79-hosted-ci.log and /private/tmp/revnet-main-37713095651-hosted-ci.log. No application source changed; the next PR revision must complete the formerly blocked browser gate.

## Markee homepage integration plan — current direction 2026-10-12

Confirmed scope: Rent / For Rent, homepage only, first rollout on https://dev.revnet.money, beneficiary streams directly to team.rev.eth; board admin remains 0x823b92d6a4b2AED4b15675c7917c9f922ea8ADAD. This supersedes Buy-first and the REV addToBalance/forwarder route. User originally limited work to planning; this turn prepares the changed Rent setup without public deployment, signing or payments.

## Plan refinement

- **Objective:** Prepare one homepage Rent board/dialog on the existing dev site before production with beneficiary ETHx streaming directly to team.rev.eth on Base and the selected independent admin; make the exact resolved recipient and setup call reviewable.
- **System fit:** Markee StreamingLeaderboard owns streams/ranking/refunds/buffers and retained Markee settlement; the existing app wallet/review/activity owners govern preparation, signatures and recovery. Resolve ENS on Ethereum mainnet, inspect the same address on Base, freeze it in setup review, create the board through the existing streaming factory, then verify admin/beneficiary/SuperApp registration and real stream receipts. Team Safe receives ETHx directly; funding the REV protocol balance is not an automatic effect of this route.
- **Reuse and simplicity:** Use the existing streaming factory, ETHx/host and team Safe. No payer clone, ETHx forwarding contract or new keeper service is required for receiving the beneficiary stream. Reuse existing dialogs, wagmi/Base transports and reviewed writes; adapt pinned Markee streaming builders rather than introducing another wallet stack or generic incorrect flow calls.
- **Evidence and unknowns:** team.rev.eth resolved on Ethereum mainnet to 0x6b92c73682f0e1fac35A18ab17efa5e77DDE9fE1 on 2026-10-12. Base VERSION()=1.4.1 and getThreshold()=3 identify its Safe implementation/threshold; reads do not prove signer access. Rent factory 0x37f420fdE5c98e611EB7cb9b74ef579D84697039 points to streaming-1.0.0 implementation 0xd2038c21efCf5245547a66f85229Cd654C7664B7, with observed beneficiary share 6200 bps and minimumMonthlyRate 999999997884000 wei/month. Exact wizard-matching create call succeeds in eth_call. Re-resolve and recheck live config immediately before execution; simulated addresses are not deployments.
- **Verification:** Run refinement gate and decode prepared calldata against recipient/admin/strategy. Implementation acceptance requires start/update/switch/stop/refund/buffer recovery, low balance/runway, account/chain drift, ambiguous receipt and partial setup recovery, UTF-8 limits, moderation/read errors and mobile/keyboard checks plus npm run check. Fork and eventual separately authorized real stream tests must prove ETHx accrues at the team Safe and refunds/cancellation work; the old Buy accounting proof is historical only.
- **Resource budget:** Bound this update to ENS/Base recipient verification, current existing Rent factory/create interface, revised plan and prepared-call artifact. Preserve unrelated shared todo work. Reuse the existing dev service; no new staging service. No Buy UI or custom receiver/automation implementation, no new contract source and no public transactions in this planning task. Replan if ENS changes, deployed source differs or final stream simulation fails.

### Exact setup

- Beneficiary ENS: team.rev.eth. Frozen observed address: 0x6b92c73682f0e1fac35A18ab17efa5e77DDE9fE1. On Base this is a three-signature Safe v1.4.1; receiving an ETHx stream does not require that Safe to sign each accrual.
- Board admin: 0x823b92d6a4b2AED4b15675c7917c9f922ea8ADAD. Direct creation from it makes it the board admin and seed owner; preserve this separately from beneficiary custody. If a different sender is necessary, prepare and verify explicit admin handoff.
- Call: Base chain 8453, target 0x37f420fdE5c98e611EB7cb9b74ef579D84697039, from selected admin, value zero, createLeaderboard(teamResolvedAddress, "revnet.money", "website", "revnet.money"). Platform tags match Markee's create-a-markee wizard/toPlatformTag behavior. Gas and actual wallet authority are required for live execution.
- [Prepared Rent call](markee-rent-setup.json) includes exact calldata and observed configuration. Canonical creation receipt plus factory event/code/admin/beneficiary checks supply the actual board/seed addresses; never configure from eth_call's predicted addresses.
- Rent pays ETHx, not unwrapped native ETH. It automatically accrues to the team Safe; it does not enter REV terminal accounting or mint REV tokens. Team unwrap/spending remains under its Safe authority if later desired, outside this direct-receipt integration.
- The factory's observed 62% beneficiary share is mutable by cooperative authority. Read material live settings in reviews and explain that the remainder belongs to Markee's per-backer settlement route. That separate settlement is not forwarding to team.rev.eth.

### Homepage behavior and owning rules

- One card below HomepageDiscovery, native lazy Rent dialog and server-visible data-markee-address. Show paid community content, Markee attribution, ETH/month and the current enforced topMarkee; project pages/footer do not get the board.
- Support create-message, back-existing, owner-edit, change-rate, switch-message and stop-stream actions. Each wallet backs at most one message per board. Include ETHx wrapping, required buffer deposits, approvals, refund-pool connection and withdrawal of unused buffer as distinct reviewed steps.
- Use the exact streaming source/builders for tagged Superfluid host batches and live agreement lookup. Preserve the created message across later-stage cancellation/failure. Stop remains accessible after homepage rollback through the external board fallback.
- Non-leading backing is refunded through the deployed GDA mechanism; gas/buffer/liquidation conditions still matter. Read effectiveRate(topMarkee()) for winning threshold, validate monthly/second conversion and byte limits from the contract. Do not promise permanent first place, zero total cost or fabricated historic earnings.
- Reuse existing review/activity/recovery owners and Safe proposal-versus-execution distinctions. Reread before writes and after confirmed execution; keep read failure distinct from empty content, display moderation placeholders when unavailable and render messages as plain text.
- Track actual visible-message views directly from the browser to canonical www.markee.xyz with session deduplication. Marketplace absence does not mean the configured board is empty. Verify Embed checks the server-rendered marker independently of transaction correctness.

### Dev-first rollout

- User requested first rollout on the Revnet dev/staging site. Existing https://dev.revnet.money/api/healthz returns status ok and revision 8c0d2cd0ac3f59665ac069b7ab105a607fddb9c2 at read time. Repository DEPLOYMENT.md documents dev branch → Railway dev → dev.revnet.money, with production main separate; verify actual service source branch before pushing because the current local CI push filter lists main/staging rather than dev.
- Build and qualify locally using deterministic browser fixtures and an isolated Base fork first, then publish the candidate to the existing dev service and verify its exact revision and homepage. Keep the production homepage/configuration unchanged until dev acceptance and subsequent production promotion.
- Dev is a website deployment environment, not a separate blockchain. The prepared Markee factory/ETHx setup is Base mainnet (8453); a connected-wallet stream from dev can use real funds. Do not substitute Base Sepolia without verified Markee test deployments. Use local fork/fixtures for no-value testing; any real board creation or test stream still requires applicable signing/funding authority.
- Enable board/config only on dev initially; verify start/update/switch/stop, deposit recovery, moderation, mobile/keyboard and team Safe ETHx accrual. An environment-scoped configured board address can later be promoted with the same verified board, avoiding duplicate creation merely for production hosting.
- Register/verify the dev URL only after dev deployment if needed for testing. Production URL verification and public production rollout remain separate later steps. Removing the dev UI does not cancel a mainnet stream; retain external stop/recovery access.

### Checkable work

- [x] Resolve current choice: Rent, direct team.rev.eth beneficiary, selected admin, homepage only.
- [x] Resolve ENS and verify Base Safe version/threshold and existing factory implementation/defaults.
- [x] Simulate exact wizard-matching creation, prepare calldata and retire Buy setup from current execution intent.
- [x] Run refinement gate and prepared-call decoding checks.
- [ ] Recheck ENS/current factory/recipient/account configuration and inventory before live creation; verify exact canonical creation receipt/code/admin/beneficiary/SuperApp state when execution is authorized.
- [ ] Implement homepage Rent UI through existing wallet/review owners after implementation authority; actual verified board address remains setup dependency.
- [ ] Prove stream start/update/switch/stop, deposits/refunds, partial setup/unknown outcomes and team Safe ETHx accrual on a Base fork; run app release gates and deterministic browser checks.
- [ ] Deploy to the existing dev service first; verify exact revision, server marker, browser/stream management and beneficiary accrual. Promote to production and verify its URL/marketplace only after dev acceptance and applicable promotion authority.
- [ ] With applicable test-funding/execution authority, verify real stream/accrual/cancellation evidence; record operations and rollback without leaving visitors unable to stop streams.

### Review and superseded artifacts

Prepared Rent setup passes read-only creation simulation; no board was deployed and no funds sent. The prior markee-buy-setup.json is explicitly superseded and must not be executed for current intent. markee-buy-fork-evidence.json remains a historical local-fork proof only. No Markee-provided receiver is needed for direct team Safe receipt.

Source references at inspected revision bbf678d17323d7f82fc31d0174635422de389988:

- [Streaming factory](https://github.com/1Hive/markee/blob/bbf678d17323d7f82fc31d0174635422de389988/contracts/streaming/StreamingLeaderboardFactory.sol)
- [Streaming leaderboard](https://github.com/1Hive/markee/blob/bbf678d17323d7f82fc31d0174635422de389988/contracts/v1.3/streaming/StreamingLeaderboard.sol)
- [Canonical create wizard](https://github.com/1Hive/markee/blob/bbf678d17323d7f82fc31d0174635422de389988/frontend/app/create-a-markee/page.tsx)
- [Streaming call builders](https://github.com/1Hive/markee/blob/bbf678d17323d7f82fc31d0174635422de389988/frontend/lib/superfluid/streaming.ts)

## Pending routing confirmation recovery — 2026-10-09

## Plan refinement

- **Objective:** A successfully submitted routing fee whose immediate confirmation is unavailable must retain recovery of the existing batch, display its full error/hash, and avoid offering fresh confirmation.
- **System fit:** PendingRoutingPayments owns foreground review; useMultichainBatch owns durable identity and recovery; useReviewedRelayr/SDK retain canonical payment and destination proof. User reports the submission succeeded; no live hash is available to prove the specific timing failure.
- **Reuse and simplicity:** Reuse getPendingBatch and savedSelection for recovery and TxError's existing wrap-anywhere presentation rule; preserve shared execution locks and payment verification.
- **Evidence and unknowns:** Screenshot proves clipped hash and stale Confirm routing action; source shows rejected/pending runBatch leaves reviewed fresh selection active. Exact confirmation failure is unknown without transaction/provider evidence.
- **Verification:** Regression-test rejected and pending submissions transitioning to the exact saved batch, preserving errors and resumed expectedBatchId; check confirm hash wrapping, routing and Relayr suites, typecheck and targeted lint.
- **Resource budget:** One read-only delegated investigation of payment proof; bounded UI changes and existing focused tests, no new polling or weakened proof, no deployment/transactions.

- [x] Trace submission, saved-batch recovery and shared error rendering.
- [x] Switch unresolved foreground submissions to existing saved recovery.
- [x] Wrap long confirmation messages and add regression checks.
- [x] Run checks and record verified results and limits.

## Plan refinement

- **Objective:** Also continue canonical reconciliation when the immediate post-broadcast confirmation check is temporarily unavailable.
- **System fit:** useReviewedRelayr already owns waitForRelayrBundle, including bounded retry and exact payment/destination proof; start that observer on transient confirmation failures while preserving the saved submission and existing error/recovery lock.
- **Reuse and simplicity:** Reuse the existing observer; no new polling logic, payment submission or proof bypass. Permanent RelayrVerificationError remains a held verification failure.
- **Evidence and unknowns:** Source starts the watcher only after immediate proof success, so a temporary failed read bypasses its retry path. User confirms a later button click registered success; exact failed RPC read remains unknown.
- **Verification:** Add a funding-hook regression that fails the immediate proof read and later verifies through the existing watcher without a second wallet send; rerun focused recovery/confirmation tests and typecheck/lint.
- **Resource budget:** Delegate only the funding-hook/test change; main agent retains foreground recovery and message wrapping. Reuse current test mocks and bounded observer.

### Confirmation recovery review

- Transient post-broadcast confirmation failures now start the existing canonical bundle observer; hard verification errors retain their previous held state.
- Foreground unresolved routing adopts saved-batch continuation, passing its exact expectedBatchId without preparing fresh calls; confirmation errors expose an accessible alert and wrap full hashes.
- Final verification: 432 tests passed across pending-routing-payments, ui-primitives, multichain-batch and reviewed-relayr-hooks; typecheck, changed-file ESLint, wallet-writes:check (142 sites), and git diff whitespace check passed.
- Regression proves immediate proof-read failure followed by verified funding/destination completion with exactly one wallet payment and duplicate submission blocked.
- Local changes only; no deployment or transactions. The particular failing RPC read in the screenshot remains unverified without its full transaction hash/provider logs.

## Compact pending-payment retry UI — 2026-10-09

- Implemented collapsed inventory, verified readable amounts, exact source/destination project names, concise Retry review/actions and canonical network-fee payment ABI decoding.
- Shared loading text uses fixed-width CSS dots with original accessible text and reduced-motion support.
- Verified: 470 tests in9 focused files, full types, changed-file lint, source invariants, transaction-boundary checks and whitespace checks. Chromium native-disclosure/loading-motion check also passes; canonical payment/recovery tests remain green.
- Refinement and cross-client evidence: ../../tasks/todo.md, latest Both-client pending payment experience record. No contracts or real transactions changed.

## Markee homepage visual prototype — 2026-10-12

## Plan refinement

- **Objective:** Place the compact Markee message above Top with smaller text and the small bottom-left Takeover this advertisement action; preserve the preview dialog and previously raised hero.
- **System fit:** HomepageDiscovery owns placement above the Top column; a small client component owns local preview state and reuses the existing accessible dialog. This visual prototype does not create a board, connect a wallet, submit a stream or change recipient/admin authority.
- **Reuse and simplicity:** Reuse existing Melon/teal colors, mono font, buttons and dialog; one new component and one hero insertion, no dependencies or new contract logic. Show on dev/loopback only so production remains unchanged.
- **Evidence and unknowns:** User explicitly requested implementation of a view prototype under the pictured audit line. Rent, team.rev.eth beneficiary and selected admin remain settled; no live board address exists. Clearly label preview content and rate so sample UI is not mistaken for live funding.
- **Verification:** Typecheck and touched-file lint/format; desktop/tablet/mobile browser checks prove the message is above Top, uses smaller text, only message/Takeover action in the card, full card visibility where space permits, wrapping, preview update, keyboard dismissal and screenshots. No wallet writes or deployed claims.
- **Resource budget:** Two app files and the existing plan; reuse installed Node and Playwright. No full streaming integration or live setup/deployment; replan only if hero layout clips the card or the existing dialog cannot support the preview.

- [x] Add the local/dev prototype card and message-preview dialog.
- [x] Verify layout and interactions; capture screenshots and document results.

Review: added MarkeePrototype.tsx and one insertion beneath HeroColumn's audit line, gated to dev/loopback hostnames. Reused existing button/dialog styling and local state only. Node 26.7 typecheck, touched-file ESLint, Prettier and diff whitespace checks pass. Chromium desktop 2048px, mobile 390px and narrow 320px checks prove placement, no horizontal overflow, editable preview, Escape dismissal, restored focus and no page errors. Evidence: /private/tmp/markee-prototype-review.json; screenshots /private/tmp/markee-prototype-desktop.png, /private/tmp/markee-prototype-mobile.png and /private/tmp/markee-prototype-dialog.png. Loopback preview runs at http://127.0.0.1:3102 using deterministic fixtures. No public deployment, wallet calls or streaming integration. Removed only the unrequested AGENTS.md/CLAUDE.md files generated by next dev during this check.

User refinement: move the illustrated hero higher and remove the Markee header, labels, supporting copy and green action bar. Keep only message text and the exact bottom-right Takeover this message text action. Reuse the existing dialog and dev/loopback gating.

Refinement review: dev/local hero content moved upward by 72px, with the smaller card starting 80px higher including the reduced gap. Removed card header, labels, supporting copy and green action bar; exact Takeover this message text button sits bottom right. Typecheck and touched-file ESLint pass; Chromium checks at 2048, 768, 390 and 320px pass placement, wrapping, preview editing, Escape and focus restoration. Desktop card height is now 123px instead of 243.5px, with full visibility. Updated screenshots and review JSON remain at the same /private/tmp/markee-prototype-* paths. No public deployment or wallet writes.

Latest placement refinement: move the message above Top and reduce the message font to 16px. Keep one card, existing dialog and dev/local gating; preserve the previously raised hero.

Latest disclosure refinement: add a subtle 10px Ad label in the card’s top-left inset while preserving the new above-Top placement, 16px message and small takeover action. Verify label geometry and the final updated preview.

Disclosure spacing refinement: increased message top padding from 24px to 40px, leaving a clear gap below the absolutely positioned Ad label. Final browser check verifies the label/message gap together with above-Top placement and preview interaction.

Final action refinement: shorten to Takeover, use 10px subdued text with hover-only underline, and preserve the accessible 44px tap area. Keep the explicit Ad/message gap and above-Top location.

Latest final disclosure: remove the top-left Ad label and use the exact action Takeover advertisement; retain quiet 10px typography and restore compact message padding now that the label is absent.

Exact action wording corrected to Takeover this advertisement. No top-left Ad label, smaller 16px message above Top, quiet 10px action at bottom right.

Final placement/disclosure review: one dev/local card above Top, 16px message, no Ad label, quiet 10px Takeover this advertisement action. Typecheck, touched-file lint/format and Chromium desktop/tablet/390px/320px placement, no-overflow, editing, Escape/focus and no-page-error checks pass. Updated local preview and screenshots at the existing paths. No public deployment or wallet calls.

Action alignment refinement: change only the action row to justify-start for bottom-left placement, preserving message, wording, styling, tap target and dialog behavior.

Takeover spacing refinement: reduce message bottom padding from 12px to 4px and action-row bottom padding from 8px to 4px; retain bottom-left alignment and the 44px hit area.

## Real Markee Rent integration — 2026-10-12

## Plan refinement

- **Objective:** Replace the local advertisement demo with a real dev-first Rent view, live board data and reviewed wallet actions; retain a small secondary Preview and primary Takeover in the site’s existing modal style. User confirms no board exists yet.
- **System fit:** Markee’s existing streaming contracts own ranking/refunds/deposits and beneficiary routing. One app module owns verified ABI/config/rate math/call builders, one hook owns reviewed multi-step execution and durable recovery, and the existing dialog displays those results. Board creation from the chosen admin is a real setup prerequisite; exact receipts/config must establish the board before any stream action. Team Safe receives ETHx directly.
- **Reuse and simplicity:** Adapt pinned upstream streaming builders and reuse wagmi/Base, dialog, wallet button, reviewed-write engine and activity journal. No custom contract, wallet stack or fake success. Keep local message Preview inside the dialog; homepage reads only verified board content. Keep dev/loopback gating and production unchanged.
- **Evidence and unknowns:** User authorized implementation of the real view and confirmed board not created. Existing prepared factory call/beneficiary/admin are known; live board address and signed setup execution remain missing. Verify factory/ENS current config and use canonical creation logs; never install a simulated address.
- **Verification:** Meaningful rate/buffer/tagged-flow/UTF-8/receipt/authority/recovery regressions, rendered modal/read-unavailable/setup cases, source wallet inventory, type/lint/format, deterministic browser layout and actual Base-fork stream/refund/stop proof. Run npm run check before release; do not claim real payments or a deployed board until canonical evidence exists.
- **Resource budget:** Delegate source/math, reviewed execution and read-only setup discovery to separate owners while root owns UI/integration. Bound setup to existing factory and team beneficiary; continue independent implementation while awaiting wallet setup. Replan on deployed-source mismatch or any inability to verify stream recovery. No public signing/deployment without applicable wallet authority.

- [x] Implement owning Markee streaming ABI/builders/reads and focused regressions.
- [x] Implement reviewed board creation and stream execution/recovery through existing wallet owners.
- [x] Replace demo modal/card with real data, setup state, Preview secondary and Takeover primary.
- [x] Verify module/UI/fork behavior and required release checks; prepare dev rollout.

Verification refinement: the full suite found four exact-text assertions that still assume unsplit loading text in three unchanged payment test files. HEAD already uses the shared animated LoadingText owner. Preserve the full expected paragraph/span text and payment-state assertions while matching the rendered owner’s textContent; no production payment behavior changes. Fix one pre-existing formatting hunk required by the format ratchet. Repeat full coverage and release checks after these bounded corrections.

Bundle verification refinement: the complete Rent lifecycle adds client code; current build measures 2700.9 KiB aggregate, 706.2 KiB largest route and 972.2 KiB route-referenced, with all wallet SDKs still lazy. Compare isolated HEAD on the same installed dependencies and inspect imports before changing any ceiling. Preserve the existing 900 KiB per-route, 1100 KiB route-referenced and lazy-SDK gates; adjust only the aggregate budget by the minimum measured feature delta if no avoidable duplication is found.

Browser verification refinement: full Playwright exposed stale pending-payment fixtures after the existing compact disclosure/source-name change. Keep production unchanged; explicitly model only the known source project 6 in the deterministic Project handler, and update the pending-routing browser test to expand the current disclosure before asserting its exact protocol/gateway-bound review actions. Preserve all unexpected-request rejection and exact network/transaction fixtures. The new advertisement action uses teal-700 to meet small-text contrast while retaining 10px quiet styling.

### Real Rent integration review

- Replaced the visual demo with verified Base board/message reads, selected-admin board creation, reviewed message/approval/stream writes, updates, stop and deposit withdrawal. Durable exact-call recovery supports direct and Safe executions; full lifecycle Web Locks prevent cross-tab journal overwrite. Definite wallet refusal clears only the matching hashless submission; configuration drift cannot block immutable exit checks.
- The compact card remains above Top with 16px message, quiet 10px bottom-left Takeover this advertisement action and accessible contrast. The existing modal now has secondary Preview and primary Takeover. Preview stays inside the modal and never replaces canonical homepage content. Uncreated setup has no fake board or sample price.
- Independent review regressions cover ETHx decay during deferred rate review and recovered Safe execution evidence. Fixed shared native-dialog focus restoration with nested-dialog regressions. Corrected pre-existing split-loading-text test assertions, exact source-project routing fixture and collapsed-disclosure browser assertions; isolated HEAD reproduced the four original unit failures.
- Release checks passed across the final runs: dependencies, dead code, environment/deployment configuration, TypeScript, full ESLint, format ratchet, source/protocol invariants, 144 wallet boundaries, coverage (2,775 tests), optimized standalone build, package/bundle gates and 144 responsive browser tests (6 existing intentional skips). 20 deterministic fixture unit tests also pass after the bounded fixture update.
- Same-lock Node 26.7 baseline HEAD 3ad4255a measured 2686.3 KiB aggregate client JavaScript; final Rent build measures 2700.7 KiB. The minimum aggregate ceiling is 2701 KiB, with 900 KiB route, 1100 KiB referenced and lazy-wallet gates unchanged. No dependencies added.
- Actual Base-fork proof creates the canonical board/message, starts tagged stream and pool connections, proves team Safe ETHx accrual, updates rate, promotes a competing message with exact losing refund, stops both and withdraws deposits. tasks/markee-rent-fork-evidence.json is explicitly private-fork-only; no public transactions were sent.
- Browser artifacts: /private/tmp/markee-real-review.json and /private/tmp/markee-real-{desktop,tablet,mobile,narrow,dialog,card}.png. Final full suite log: /private/tmp/revnet-markee-browser-final.log; coverage: /private/tmp/revnet-markee-coverage.log.
- Live rollout remains a separate wallet/hosting step: connect selected admin and sign Create advertisement, then put its verified receipt-derived address in dev NEXT_PUBLIC_MARKEE_RENT_BOARD_ADDRESS and rebuild. No live board, hosted deployment or production promotion is claimed.
- Local handoff restored at http://localhost:3002 with real configured providers, deterministic mode off and no board address. HTTP 200 proves Markee advertisement/action markup and no demo copy; Para public application key is configured. Removed only Next-generated AGENTS.md/CLAUDE.md after reading their instructions.

## Restore homepage hero and action wording — 2026-10-12

## Plan refinement

- **Objective:** Restore the original hero spacing now that the advertisement sits above Top; spell every visible Markee action Take over.
- **System fit:** HomepageDiscovery owns hero layout; MarkeeAdvertisement and its reviewed-status text own labels. Board reads, payments and recovery remain unchanged.
- **Reuse and simplicity:** Remove the obsolete compact hero prop and conditional offsets; reuse the original static classes and existing modal buttons.
- **Evidence and unknowns:** The user screenshot and explicit correction supersede the earlier raised-hero and Takeover spelling requests. Original classes are available in HEAD.
- **Verification:** Focused rendered UI tests, touched-file lint/format, typecheck and local Chromium geometry/copy check; no financial behavior changed.
- **Resource budget:** Small layout/copy edit, no new abstractions, tests or dependencies; reuse existing tests and running local server.

- [x] Restore hero classes and visible action spelling, update existing expectations.
- [x] Verify local view and document results.

## Trending project chain membership — 2026-10-12

## Plan refinement

- **Objective:** Show every supported member chain beside each composite Trending project, preserving the existing ranking and volume/payment display.
- **System fit:** HomepageDiscovery owns ranked row presentation; the existing cached getSuckerGroup display reader owns cross-chain membership. Wallet authority, financial actions, and New project presentation are unchanged.
- **Reuse and simplicity:** Reuse getSuckerGroup and ChainLogo, enrich only eight Trending rows, and deduplicate known chain IDs without introducing a new data or icon owner.
- **Evidence and unknowns:** Indexed activity rows contain only a representative chain and bounded ranking pages cannot prove all memberships; sucker-group member identities supply complete indexed chain evidence. An unavailable group leaves the verified representative icon.
- **Verification:** Rendered regression checks cover multi-chain membership, duplicate/unsupported chains, unchanged ranking details and unavailable-group fallback; run touched-file lint/format and repository typecheck.
- **Resource budget:** One bounded parallel membership read per visible Trending group, shared successful-read cache, no new dependencies or public-chain actions.

- [x] Enrich Trending members and render accessible chain icons.
- [x] Run focused regression/type/lint checks and record results.

### Trending chain review

- Trending rows now reuse the cached indexed sucker-group reader to show every supported member chain, once, with accessible names. Eight row lookups run in parallel with the existing fingerprint reads; failed membership reads retain the known representative chain. Existing ranking order, payment counts, volume units, links and New launch-chain behavior remain unchanged.
- Three rendered regressions pass: four-chain composite membership despite Base activity, duplicate/unsupported/wrong-group/version exclusion and unavailable-membership fallback. Repository typecheck, touched-file ESLint with zero warnings and Prettier pass. No public transactions or deployment were performed.

Hero/action review: restored original sm:pt-6 and zero car margin, removed the compact prop, and changed visible labels/status to Take over. Desktop 2048px and mobile390px Chromium checks prove original hero spacing, ad above Top, local Preview, exact primary Take over and no horizontal overflow. Existing Markee UI/hook regressions and type/lint checks pass; no stream behavior changed. Screenshots /private/tmp/markee-refinement-2048.png and /private/tmp/markee-refinement-390.png. Live Trending read also proves four icons for Juicebox/REV/Markee and one Base icon for the bot, preserving ranking details.

Trending responsive refinement: live 768px measurements found a 219px row with only 15px left for detail beside the 76px four-icon cluster. Stack existing marks vertically below 2xl to preserve detail width in tablet and narrow mobile columns; retain the horizontal cluster on wide screens. Verify live row/detail bounds and rerun the same rendered regression/lint gates.

Responsive verification passes after the icon-only change: at 768px the row/detail widths are 219px/75px with equal detail scrollWidth; at 320px they are 270px/126px, also without horizontal detail overflow. Four accessible icons remain visible in both; detail bottoms stay within each row. Screenshots: /tmp/trending-geometry-768.png and /tmp/trending-geometry-320.png. Three rendered regressions and touched-file ESLint still pass.

## Markee creation transaction preflight — 2026-10-13

## Plan refinement

- **Objective:** Answer whether the current site creation action is ready to sign, using fresh live evidence for the exact selected-admin call and explicit wallet matching fields.
- **System fit:** useMarkee owns the prepared creation call and final ENS/factory rechecks; reviewed-write owner controls wallet consent and account identity; canonical factory logs and board reads control acceptance. This verification adds no execution authority.
- **Reuse and simplicity:** Reuse factory ABI, constants and readMarkeeFactory from the app, prior private-fork lifecycle evidence and focused creation/recovery tests; only read-only simulation and a small evidence record.
- **Evidence and unknowns:** The board was not created at the last handoff. Verify latest Base implementation/settings and Ethereum team.rev.eth resolution; do not equate a successful simulation with an audit or claim to have inspected an unseen wallet payload.
- **Verification:** Simulate exact createLeaderboard call with value zero from selected admin on Base, compare calldata to prepared artifact, inspect factory/code/version and beneficiary, run focused creation tests. Present chain, sender, target, amount and arguments for final wallet comparison.
- **Resource budget:** Bounded public RPC reads and simulation, no signing/broadcast/deployment; replan if factory or beneficiary changed or simulation fails.

- [x] Fresh live identity/ENS/factory reads and exact creation simulation.
- [x] Verify current creation guards and report confidence plus wallet matching fields.

Creation preflight review: fresh Base block52559580 (2026-10-13T16:21:47Z) verified the same streaming implementation, host/token and zero-value exact creation calldata. Ethereum team.rev.eth still resolves to the reviewed Base Safe; selected admin has no contract code. eth_call succeeds and gas estimation succeeds (1,000,437 gas units, not a total fee quote). Factory split currently62% beneficiary/38% platform and remains a mutable factory setting. Current app final-send guard repeats ENS/recipient and factory identity/settings checks, reviewed wallet owner binds account, and canonical creation receipt validates resulting admin/beneficiary. 52 focused core/hook/recovery tests pass. Evidence tasks/markee-creation-preflight.json; publicBroadcast=false and walletPayloadObserved=false. This is scoped transaction qualification, not a whole-protocol security audit or an unseen-wallet guarantee.

## Launch resume never deploys a second revnet (joint2 finding 2, 2026-10-14)

Shared rule: one recovery order on all four sites (held, settled success, no hold record, check required).

- [x] Red first: settled-before-resume, settlement during send/exit, unauthenticatable recovery reaching "I checked it. Launch again", hash saved by the SDK but not the page, main-era namespace hold (13 failing before the fix).
- [x] `recoverSavedLaunch` (launchIntent.ts) runs before any send of a resumed saved launch: held holds are asked of the chain first; a settled success is reconciled against its exact receipt (DeployRevnet in that transaction, saved salt); no record scans the salt; any read failure or empty scan is CHECK-REQUIRED, never a send.
- [x] `sendUnderHold` refuses at the gate's beforeSend when the send's own check settles an earlier success (also for the previous build's namespaces): nothing is sent again, and the page reconciles it.
- [x] After a failed send, the page recovers again (settlement found during the exit is the result); with nothing held, the saved attempt is retired so a wallet rejection never demands a check. Only the check action otherwise retires it; the next launch gets a fresh salt.

### Review

`npm run check` green: 2904 unit tests, 144 browser tests, bundle 2743.8 of 2746 KiB (no budget change).

## Joint round 3: launch recovery invariants A-D (2026-10-14)

- [x] Red first (26 helper + 4 page tests): settled success with empty/mismatched logs, with and without fromBlock, never clear; no-record/no-fromBlock is check; recovery and its held exit run before upload, fee, token and feed preparation; the mount scan shows a check on discovery failure; the check alone retires, then a fresh salt.
- [x] The journal is written at the hook's `beforeSubmission` (the hold reserved the wallet) with salt, fromBlock, hold namespaces and the settlements already there (`before`), and removed only where the SDK drops the reservation (definite rejection, abort before the wallet). So a journal always means "may have reached the wallet".
- [x] `recoverLaunch(key)` (never throws): held (asked of the chain first; the SDK exit is offered before preparation and, once taken, retires the attempt); any success not in `before` wins and must show its own DeployRevnet event with the saved salt, else check; a final revert retires; no record scans the salt, else check.
- [x] `takeHeldExit` extracted unchanged from `sendUnderHold` so the page offers the same exit.

### Review

`npm run check` green: 2911 unit tests, 144 browser tests, bundle 2743.9 of 2746 KiB (no budget change). Audited: Relayr multichain launch keeps its own signature-window gate (unchanged); legacy Safe proposal adoption refusal keeps the journal refusing, never permits a send.

## Joint round 4, finding 1: a known success is never discarded (2026-10-14)

- [x] Red first (8 tests): a settled success with an unreadable receipt, empty logs, another salt or another transaction's event is journaled (`settled`) before any read and stays `confirming`; it is still followed once the hold forgets it; a later failed settlement never downgrades it; the page offers only "Check again", never "I checked it" or a resend.
- [x] `recoverLaunch` follows a journaled settlement first; `LaunchConfirmingNotice` re-runs recovery. Markee and Relayr findings 2-4 are queued for the SDK engine migration (coordinator ruling).

### Review

`npm run check` green: 2914 unit tests, 144 browser tests, bundle 2744.1 of 2746 KiB.

## Joint round 5, findings 2 and 3 (2026-10-14)

- [x] Red first: main-era cash outs and bridges keyed by the 10%, 25% and 50% buttons (`policy:10%` etc., origin/main 71c24286 BridgeDialog/RedeemDialog) are rebuilt; a cash out retried on the other venue is refused while the 25% one is unresolved. `AMOUNT_OPTIONS` is the one list for cash out, bridge and borrow.
- [x] Red first: a stale "I checked it" in one tab after another tab journaled the success keeps it and follows it ("Check again"). `releaseLaunch` re-reads the journal and refuses a saved success; the check, the SDK exit and a dropped reservation all release through it.

### Review

`npm run check`: 2921 unit tests and every step green except one unrelated browser timing flake (project-shape alias tab, tablet-768); `npm run test:browser` rerun alone passed 144/144. Bundle 2744.2 of 2746 KiB.

## Joint round 6, finding 2: an unreadable journal is never released (2026-10-14)

- [x] Red first (6 tests): a launch journal storage won't read, or a malformed record, throws `JOURNAL_UNREADABLE_LINE` ("Couldn't check this transaction. Try again.") instead of reading as absent; release refuses and deletes nothing; recovery returns check, never none; the page keeps the check and its button with the line, and a submit prepares and sends nothing.
- [x] Audit of writes/deletes after forgiving reads: the sucker-extension salt store read a malformed store as `{}` and the next write replaced it, dropping salts deployed peers need; it now refuses and never writes or clears over it. Multichain batch journal already throws; transaction activity already stops writing after a failed read; the Safe batch tray is a convenience queue (no recovery); Markee is queued for the SDK engine migration.

### Review

`npm run check` green in one pass: 2928 unit tests, 144 browser tests, bundle 2744.3 of 2746 KiB.

## The warned continue past an unreadable journal (SDK engine parity, 2026-10-14)

- [x] Red first (5 tests): after "I checked it" fails with the unreadable line (and only then), "This browser can't read its saved transactions. Check your wallet before sending again." sits above "I checked my wallet. Continue anyway"; it discards the record and reopens the flow, which launches with a fresh salt. Storage that won't read or delete lets the discarded key read as absent in this tab until it reads again.
- [x] The sucker salt store blocks every extension while unreadable, so it gets the same warned continue in its confirm dialog after an extension failed on it. Strings next to JOURNAL_UNREADABLE_LINE; one `UnreadableJournalExit` component for both.

### Review

`npm run check` green: 2933 unit tests, 144 browser tests, bundle 2744.6 of 2746 KiB.

## Final joint round, item 2: a stale retirement never deletes a newer attempt (2026-10-14)

- [x] Red first (4 tests): tab A's reverted retirement, salt-scan retirement, and stale check all keep tab B's newer salt2 journal.
- [x] `releaseLaunch(key, snapshot)` is the one guard: a strict re-read, kept when the journal is now another salt or holds a success other than the snapshot's. Every retirement (recovery's reverted/launched, receipt success, check, exit, dropped reservation) goes through it; the warned discard re-reads and recovers instead when the record reads again.

### Review

`npm run check` green: 2937 unit tests, 144 browser tests, bundle 2744.8 of 2746 KiB.

# SDK 2.39 migration: one held write, one saved-attempt recovery (2026-10-14)

Brief: ALIGN/migration-brief.md (step 3 of ALIGN/FINISH.md), rules frozen in ALIGN/recovery-rule.md. Branch feat/sdk-239 from origin/main 35ac6308.

## Plan refinement

- **Objective:** Revnet runs every held wallet write and every saved-attempt recovery through @bananapus/nana-sdk-core 2.39.0 (createHeldWriteView, followHeldWrite, createSavedAttemptRecovery) deletes its app copies (sendUnderHold, takeHeldExit, the "Your earlier transaction went through." gate, useWriteHoldWatch, the Safe follower, recoverLaunch/releaseLaunch/discardUnreadableLaunch, UnreadableJournalExit, Markee's exit and adoption glue, Relayr's checked-recovery dead ends) and adds no step, notice or wait to the normal pay, cash-out or launch path.
- **System fit:** Outcome (nothing sent twice, nothing lost) -> SDK hold controller (writeHolds, unchanged) -> one held-write view per send (SDK) that owns the send gate, exit, away-success gate and follower -> app UI only displays the view (flow dialog, activity row, receipt hook) -> domain journals (launch salt, Markee step, Relayr session) stay as data and feed `authenticate`/`confirmRetirable` -> SDK recovery decides held/done/check/none. Unaffected: intent keys (SDK builders + frozen legacy-intents.ts passed as `legacy`), review dialogs, simulation, Relayr signing/funding controller, Bendystraw reads.
- **Reuse and simplicity:** Reuse createHeldWriteView (the framework-free core useHeldWrite binds) inside the generic useWriteContract because its call is only known at send time; bind createSavedAttemptRecovery in the launch page with the same outcome/checkAction/unreadableAction shape useSavedAttempt returns. All copy comes from SDK constants. Delete rather than adapt; keep write-hold.ts only as the hold/recovery singletons and intent plumbing.
- **Evidence and unknowns:** SDK 2.39.0 dist read in full for heldWrite.js and savedAttempt.js; CHANGELOG reviewed. Replanned: nana-sdk-react 53.0.0 cannot be imported by a wagmi 3 app (peer wagmi ^2; webpack fails with "'useToken' is not exported from 'wagmi'", verified by a probe build), so it is not added; its hooks are thin bindings of the core used here, and they swap in once the react package supports wagmi 3. Baseline with the bumped SDK: typecheck green, 5 Safe-follower tests fail on 2.39's new Safe pending rule (code being replaced). Bundle headroom is 1.2 KiB; the budget is bumped to fit (standing rule). The browser harness has no wallet, so the happy-path click/notice comparison runs in jsdom against the real hooks.
- **Verification:** Red-first scenario tests ported to the SDK path (double-send, settled-while-away, unreadable storage, stale check, wallet rejection, reload between SDK hash and journal hash, main-era record); a grep gate in scripts/check-source-invariants.mjs naming the deleted helpers and app-side hold/journal localStorage keys; a happy-path test asserting one review and one wallet call with no added notice on pay, cash-out and launch; full `npm run check` (unit, coverage, build, bundle, standalone, every browser suite).
- **Resource budget:** One worktree, no subagents, phases in order (deps, held send, follower and receipt hook, launch, Markee, Relayr, gate, tests), each closed by focused vitest runs before the next; one full `npm run check` at the end, rerun only failed suites. Replan if the react package can't build against wagmi 3 or the SDK view can't express a current flow without a new behaviour.

## Checklist

- [x] Deps: core 2.39.0 (Node 26, npm 12.0.1). react 53.0.0 not added: it can't build against wagmi 3.
- [x] Held send: one SDK view per send (send gate, exit dialog, away-success "Send it again", follower kept until told); deleted sendUnderHold, takeHeldExit, WENT_THROUGH, hidesShownExit/offersExit/settledLine copies, adoptIntoHold, holdsHash, rememberHold.
- [x] Safe follower and receipt hook read the view; deleted holdUntilResolved, watchSafeProposal and useWriteHoldWatch.
- [x] Launch: launchIntent.ts keeps the journal as data; createSavedAttemptRecovery decides (launchRecovery.ts); LaunchCheckNotice shows the SDK check and the warned unreadable exit; LaunchHeldNotice shows the view and its exit on mount too; deleted recoverLaunch, releaseLaunch, discardUnreadableLaunch, UnreadableJournalExit.
- [x] Markee: pending step recovered through the SDK (authenticate = Markee verification, confirmRetirable = journal re-read), held by a Markee intent key.
- [x] Relayr: a saved session whose check throws gets the SDK's check and its retirement on the account page.
- [x] Grep gate (scripts/app-hold-logic.mjs, source:check and its own test), ported scenario tests, happy-path test.
- [ ] Full gate, push, PR (no merge).

### Review

`npm run check` green in one pass (Node 26.7.0, npm 12.0.1): dependency, dead-code, env, deployment, type, lint, format, source (with the new hold-logic gate), protocol, wallet-write (142 sites), coverage (2,883 tests passed, one skipped), browser build, standalone, bundle (2,742.1 of 2,746 KiB, down from 2,744.8) and browser (144 passed). Net diff about -1,600 lines (src -520).

Rulings: nana-sdk-react 53.0.0 is not added (it can't build against wagmi 3: `useToken` is gone), so the SDK's framework-free cores are bound directly; swap in useHeldWrite/useSavedAttempt once the react package supports wagmi 3. The SDK view tells a settlement it first sees during a send's own check and its gate then lets that send through, so sendHeld refuses that send itself (SDK gap to close upstream). Markee steps are keyed by a new `markee` writeIntentKey (no SDK builder). Hold states take the SDK's copy (HELD_CONFIRMING_LINE and the rest). A success that settled while the page was closed asks "Send it again" (SDK rule).

### Coordinator rulings (2026-10-14)

- [x] (2) The Safe approvals count stays revnet's ("Waiting for your Safe's approvals: 1 of 2."), read from Safe's service and the Safe's current owners at most once a minute while a proposal awaits its signers; the SDK's copy is used only for hold states. Test red first.
- [x] (4) A proposal journaled without its reviewed calls settles from the chain as on main (its execution via the SDK's waitForSafeExecutionHash, then the Safe's execution event in its receipt); unproven stays Unconfirmed with Dismiss. Main's test restored, red first.
- [x] (1)/(5) SDK 2.40.0: core bumped (nana-sdk-react not added); sendHeld's own mid-send refusal deleted (the view's gate refuses it now); the launch page binds `useSavedAttempt` and its held notice `useHeldWrite` from `@bananapus/nana-sdk-core/review/react`; the account page shows `HeldWritesNotice` over `useHeldWrites` per supported chain. No pre-2.39 workaround existed. The generic `useWriteContract` keeps `createHeldWriteView` per send (its call is only known at send time, which a hook's fixed options can't take), and the receipt hook reads that send's view. Markee and the Relayr account check stay on the core recovery calls (imperative, one button each).

#### SDK 2.40.0 review

`npm run check` green: 2,885 unit tests, 144 browser tests, bundle 2,747.6 KiB under the aggregate ceiling raised from 2,746 to 2,750 KiB (route limits unchanged). A per-render `getPublicClient` restarted `useSavedAttempt`'s recovery in a loop under the test mock (heap exhaustion under coverage); the page now memoizes one client per attempt.

# SDK 2.41.0: held sends through useHeldSend (2026-10-15)

## Plan refinement

- **Objective:** Take core 2.41.0; every held send goes through the SDK's `useHeldSend` and every followed proposal or write through `useHeldWrite`, so no app code makes a held-write view (gate enforced); a retry after "I checked it" keeps the launch's salt (Homerun parity); burn and generic Safe batches use the 2.41 builders with the old keys as `legacy`.
- **System fit:** Sends: `useWriteContract` and `useProposeSafeBatch` pick the chain's `useHeldSend` at send time; the flow dialogs (exit, "Send it again") act on the hold handle. Following: `HeldRowFollowers` (mounted at the app root) follows every Safe proposal and every direct write until told, whatever screen sent it; the receipt hook reads a direct write's hold through `useHeldWrite` from the row's saved hold. Launch, Markee and Relayr recovery are unchanged apart from the salt and Markee's exit on the handle.
- **Reuse and simplicity:** SDK hooks own views and followers; the app keeps only its row display (Safe approvals count, settled lines) and dialogs. Redeem, allowance and sync have no app-keyed writes in revnet, so nothing to switch.
- **Evidence and unknowns:** 2.41.0 dist read (useHeldSend, intents). Homerun reported three 2.41.0 view bugs (lost subscription after a send, no checked read after it, self-withdrawn reservation read as another window's release); 2.41.1 fixes them, no app shims. Tests that relied on instant settlement now land the receipt after the send, as on a real chain.
- **Verification:** Full `npm run check`; the gate test refuses `createHeldWriteView`/`followHeldWrite`; salt retry tests (page and journal); burn and batch keys; happy path twice in a row.
- **Resource budget:** One worktree, no subagents; bump to 2.41.1 in this PR when the coordinator says it's out.

## Checklist

- [x] Core 2.41.0.
- [x] `useHeldSend` per supported chain in `useWriteContract`; `useProposeSafeBatch`; `HeldRowFollowers` with `useHeldWrite`; receipt hook on `useHeldWrite`; Markee exit on the hold handle; gate forbids app-made views.
- [x] "I checked it" (or the held exit) keeps the salt for the retry; a new launch still gets a fresh one.
- [x] `burnIntent` for burns; `safeBatchIntent` for batches without an action intent, the old batch namespace as legacy.
- [x] Bump to 2.41.1 (it carries the shared same-key listeners; there is no 2.41.2).
- [x] On 2.41.1 (handles of one key share listeners in a tab): bump, delete the receipt-time `check()` of the sending view (followSubmission's onReceipt in useWriteContract) and the root follower's acknowledge of a Safe success it never saw held (HeldRowFollowers), and confirm the immediate second send ("releases the hold once the earlier send's receipt lands", the happy path twice in a row) through the SDK alone, with the receipt landing instantly as well as after the send.

### Review

`npm run check` green: 2,887 unit tests, 144 browser tests, bundle 2,739.1 KiB (down from 2,747.6). No app code makes a held-write view (gate and its test). Waiting on 2.41.1 for the three view fixes Homerun reported.

### 2.41.1 review

Core 2.41.1. Both app-side stand-ins are gone: a direct write's receipt goes to its hold through the SDK's `onReceipt` (the sending view hears it through the shared listeners), and the root follower only shows a success it never saw held. The root follower now writes a direct write's settled result into its row (so a write that settles after a reload is shown, and told, there). The immediate second send passes through the SDK alone with the receipt landing at once and after the send ("releases the hold once the earlier send's receipt lands", and pay, cash-out and launch twice in a row).

## 2026-10-20 — Bendystraw per-token data

Brief: /private/tmp/claude-501/-Users-jango-Documents-jb-v6-evm/7d1fdce3-54c6-4145-93c3-bfa2558645d2/scratchpad/client-round-brief.md. Branch fix/bendystraw-per-token off origin/main bd260965.

- [x] Registry: event `tokenSymbol` (activity + account beneficiary pay/cash-out rows also get `token decimals`); SuckerGroup projects `accountingTokenCount` + `projectTokenBalances`; indexed projects `volumeUsd trendingVolumeUsd accountingTokenCount`; TopSuckerGroups `balanceUsd volumeUsd` + per-project `projectTokenBalances`; SuckerGroupMoments `balanceUsd volumeUsd`; AddToBalanceInflows `amountUsd`; PayEventRates `token decimals`; ShieldGroup `balanceUsd` + `projectTokenBalances`; ProjectMoments replaced by ProjectTokenBalanceMoments.
- [x] One home for native-unit rows: `lib/project-link-preview.ts` reads `projectTokenBalances` (raw balance only when the field is absent); link preview, OG card and shields label through it.
- [x] Top projects rank on `suckerGroup.balanceUsd`; ETH price feed removed from home and shields (`lib/ethPrice.ts` deleted if unused).
- [x] Homepage reserves: per-token rows for ETH/USDC/other per chain, `balanceUsd` total, `volumeUsd` + add-to-balance `amountUsd` passed through, history from moment `balanceUsd`/`volumeUsd`, per-chain history and REV fees from per-token balance moments.
- [x] Floor chart: a group holding more than one token (count or kind) uses moment `balanceUsd` over the accounting token's own indexed rate; single-token groups keep the exact raw path.
- [x] Pay-event rates filtered to the accounting token.
- [x] Trending: native amount only for a single accounting token, else `trendingVolumeUsd`. Discover/search rank on `volumeUsd`.
- [x] Activity: `ownToken` prefers the event's `tokenSymbol`; project feed goes USD when any chain has `accountingTokenCount > 1`; account beneficiary rows use their own token.
- [x] Fixtures, schema docs, data policy, tests; `npm run check`; Codex loop; PR (no merge).

## Plan refinement

- **Objective:** Every revnet.money surface that totals, ranks, charts or labels treasury money uses Bendystraw's new per-token and USD fields so a project accepting several tokens is never shown as one token's units; nothing blanks when a field is missing.
- **System fit:** Bendystraw (owner of indexed truth) -> static registry documents + operation validators -> server loaders (top, reserves, floor, rates, shields, preview, discover/search) and client mappers (activity) -> UI; Header TVL stays on-chain (live balances, already correct), wallet writes and SDK are unaffected; jbm gets the same rules in parallel.
- **Reuse and simplicity:** Reuse `formatProjectPreviewBalance` as the single native-unit formatter (shields adopts it), `getTokenSymbolFromAddress` as the symbol fallback, `usdRateOf` for 18-dec rates; delete the ETH price feed path and ProjectMoments instead of adding parallel helpers; no new modules beyond one operation.
- **Evidence and unknowns:** Live introspection of both endpoints (2026-10-20) shows every field; live data shows multi-token groups (Breadfruit, 2865fc...) and that `suckerGroupMoment.accountingTokenUsdRate` follows the triggering chain's last-set context, so it is not used for multi-token floors; per-chain `usdRate` values differ (each chain's latest event), so REV fees use each row's own current rate.
- **Verification:** Unit tests per surface (top ranking from balanceUsd, reserves multi-token count, floor multi-token, rate filter, preview rows, shields, trending, activity symbol + account rows), live schema contract test, full `npm run check` (suites one at a time), Codex sol review loop until approve.
- **Resource budget:** One worktree, one PR; read only touched modules; live checks limited to introspection and two sample queries; replan if a surface needs SDK or indexer changes.

### Review

`npm run check` green (2903 unit tests, 160 browser, 10 existing skips; no budget change). Codex gpt-6.1-sol: 7 passes, approved on the 7th; fixes covered known event tokens beating USD mode, add-to-balance USD fallback, selected `balanceUsd` on Top rows, unpriced/missing history, unreadable symbols, and token identity by address for anything but ETH/USDC (`tokenKindOf`). Declined: a fallback query for schema absence (the live schema contract test gates field presence). The browser fixture's reserve history now passes the response contract, which surfaced the chart's 3.03:1 axis labels; fixed. Header TVL stays on chain (live balances, already correct).

# Incomplete wallet balances — 2026-10-24

## Plan refinement
- **Objective:** Never display failed or incomplete cross-chain balances as zero or a complete total, while retaining known per-chain balances for existing actions.
- **System fit:** The sucker-balance hook owns known per-chain rows and loading/error evidence; WalletButton and V6YouCard own aggregate presentation. No transaction authority or contract changes.
- **Reuse and simplicity:** Reuse existing hook status flags, pair verification and Unavailable presentation. Omit unknown home rows instead of manufacturing zero; keep confirmed zero balances.
- **Evidence and unknowns:** Refreshed origin/main is bc87b898. The hook substitutes zero for missing home data and WalletButton ignores failures; aggregate card consumers also require inspection.
- **Verification:** Add real-hook missing-home/peer/registry loading regressions and rendered menu error/zero regressions, then typecheck, lint, formatting and relevant suites. Run repository checks and CI on the PR.
- **Resource budget:** One isolated worktree and existing tests; no new dependencies or abstractions. Broaden only to actual aggregate consumers.

- [x] Trace and repair incomplete balance representation and aggregate consumers.
- [x] Add regressions, 38 focused cases pass; full coverage and static checks run before final handoff.
- [ ] Commit and open a PR with evidence.

Review: Unknown home balances are omitted rather than fabricated; registry verification remains pending for aggregate display. Wallet menu rejects incomplete/error totals, and the You card distinguishes unavailable holdings and partial totals while preserving available per-chain actions. Fresh locked dependencies, protocol/source/wallet inventories and dead-code checks pass. Typecheck, full lint, formatting ratchet and focused cases pass; full coverage results recorded below when terminal. Aggregate completeness is explicit and requires a verified registry, successful peer query and known home balance, including unresolved nonloading states without an explicit error.

# Preserve Revnet stage order with exact cycle boundaries — 2026-10-24

## Plan refinement
- **Objective:** Encode each later revnet stage after the preceding stage's actual cycle boundary, preserving first-start pin and explicit delay choices while preventing intermediate stages from being skipped.
- **System fit:** The existing timing/issuance helper owns encoded second-based cut frequency and snapped stage intervals; deploy compiler, chart and duration/issuance display consume that result. Existing stale-quote/recovery behavior remains unchanged; no contracts are modified.
- **Reuse and simplicity:** Extend calculatePickupIssuance's existing timing owner instead of introducing a new framework. Reuse the first absolute start and sequential compiler loop, replacing raw-day accumulation with encoded-second interval snapping.
- **Evidence and unknowns:** With a30day predecessor,1.5cuts requests45days but core snaps to60days; deriving a subsequent start from45days can bypass that stage. REVDeployer emits no approval hooks, so pinned absolute boundaries are independent of execution delay. Zero-frequency stages keep explicit delay behavior.
- **Verification:** Add compiler and helper regressions for three-stage fractional cuts, fractional encoded frequencies, no-cut predecessor, explicit first date and delayed execution; assert real unchanged-contract ancestry using a scratch acceptance fixture. Run focused suites, type/lint/format and applicable production checks before independent GPT Astra review.
- **Resource budget:** One timing owner plus compiler/chart callers and existing tests, no package or contract changes. Reuse physical locked dependencies from the completed balance worktree and cap concurrent test workers.

- [x] Add failing helper/compiler schedule regressions.
- [x] Reuse exact timing owner in compiler, chart and inherited issuance.
- [x] Run required checks and report source-bound evidence for Astra review.

Review progress: Baseline compiler tests failed with45/46day starts where core actually needs60/61days. The fixed compiler and chart share absolute start derivation and encoded whole-second frequencies. Five focused suites pass38tests, including rendered rounding feedback; type/lint/format/source/dead-code/dependency/wallet checks pass. A scratch acceptance fixture consumed actual emitted compiler JSON against unchanged contracts and passed5tests, including one-second and100day execution delays with exact basedOn ancestry and active weights. Full coverage and production build are running against frozen algorithm source. No contract modifications, dependencies or transport changes.

Final review: 2,841 tests across284files pass with existing coverage thresholds;160browser/accessibility cases pass with10existing skips. Production build/types, standalone, every original bundle ceiling (aggregate2753.3/2754KiB), lint, formatting ratchet, source/dead-code, dependency/wallet and environment/deployment fixtures pass. Duplicate schedule footnotes were removed to stay within the unchanged create-page ceiling; NotesSection remains local to its component. Separate GPT Astra review found no blocker in the schedule code or the final copy-only cleanup, and independently checked300integer cycle eligibility cases. Final emitted compiler JSON was regenerated and verified against unchanged core contracts: two new1second/100day ancestry cases plus three inherited approval lifecycle cases pass. These are direct-controller ordering checks, not a claim of identical late revnet activation/loan-lock behavior. Existing first-start and stale-quote policies remain unchanged; no contracts, dependencies or transport paths changed. An initial sandboxed full run failed only in network/local-server suites; rerunning with required access passed without weakening tests.


# Client convergence, 2026-10-24

## Plan refinement
- **Objective:** Apply five selected rules to Revnet only; wait for voting clarification and preserve dirty original tree, contracts, publishing and merges.
- **System fit:** Shared reviewed-send adapter owns current-wallet resolution; tokenUtils owns asset identity for preview/API/OG consumers; itemDraft/compiler owns reserve constraints; layout owners preserve unknown balances. Reviewed account/chain/route and recovery remain authoritative.
- **Reuse and simplicity:** Reuse existing guards, token helpers, validation and tests. Carry parent chain through existing token rows, avoiding new aggregation machinery or dependencies.
- **Evidence and unknowns:** Isolated source starts at origin/main 733d6c72efb5a1d52b17a46c3a4a665e5d12f9a2. Equal-address custom tokens on two chains currently merge; connector-only changes currently refuse. Voting semantics pending user answer.
- **Verification:** Add source-bound wallet/identity regressions, inspect supply and unknown-balance sibling paths; run focused tests and required repository checks with physically copied locked dependencies. Report exact passes and limits.
- **Resource budget:** One bounded consumer trace per rule, minimal owning changes, reused physical dependencies, focused then repository checks. Replan only on changed voting policy or shared ownership.

- [x] Trace consumers and implement applicable rules.
- [x] Add regression evidence and run repository checks.
- [x] Record five-rule matrix and verification limits.

## Plan refinement
- **Objective:** User clarified all new shop tiers use price-based votes, including imported positive custom voting input; keep the other four convergence rules unchanged.
- **System fit:** Shared itemDraft compiler owns the false flag; ItemDraftFields and summaries describe price-based economics. Existing no-new-votes collections reject priced additions because they cannot honor price-based votes under their lock.
- **Reuse and simplicity:** Retain legacy draft field for import compatibility, ignore its value in encoding, replace the input with plain explanatory copy and remove obsolete custom-vote validation. Reuse shop restriction checks.
- **Evidence and unknowns:** Explicit user Yes always price-based supersedes interim zero-only assumption; deployed hook interprets false as price-derived votes. No existing onchain tiers change.
- **Verification:** Test empty, zero, positive and malformed imported voting fields all encode false and zero custom units; test locked-vote collections refuse priced additions. Run repository checks after final edits.
- **Resource budget:** One bounded compiler/UI/summary trace and existing regression edits, then final gates. No new voting framework or contract changes.

Additional evidence: malformed/missing treasury rows were previously skipped or coerced to zero by preview/shield aggregation. The preview now reports Unavailable for an incomplete treasury; shield numeric totals are null for unread amounts, while legitimate confirmed zero remains zero. Source-bound missing/null/empty/malformed regressions cover both owners. Same-account Safe queue execution also contained a wrapper connector-only refusal, now removed while retaining queue freshness, sender and adapter route checks.

## Plan refinement
- **Objective:** Enforce price-based shop items on new authorizations and funding of historical unsigned/unfunded saved calls, preserving signed bytes and funded reconciliation.
- **System fit:** Shop calldata policy decodes adjustTiers at wallet submission/signature and Relayr funding boundaries. Read-only recovery continues without policy checks; canonical new drafts already rebuild through the false-flag compiler.
- **Reuse and simplicity:** Reuse canonical hook/forwarder ABI decoding and one small policy owner. Reject outdated custom-vote calldata with rebuild guidance rather than mutating saved journals.
- **Evidence and unknowns:** AddItemsModal resume passes no calls and loads historical encoded batches, bypassing the new compiler. Create recovery reads saved launch evidence rather than re-encoding a historical signed plan.
- **Verification:** Test direct and forwarder-wrapped historical adjustTiers calls reject true flags and accept false, and exercise real wallet adapter refusal before old bytes open the wallet. Retain funded recovery suites.
- **Resource budget:** Bounded shared guard at new wallet boundaries and new Relayr funding recheck, no generic entry guard, framework or historical migration.

## Convergence review
| Rule | Owning result | Durable evidence |
| --- | --- | --- |
| Price-based votes | Shared compiler always encodes false and zero custom units; editor explains price-based votes; existing locked-vote collections refuse priced additions. New signing/funding of historical custom payloads is refused without rewriting recovery. | add-items-modal, shop-batch, shop-voting-policy, current-wallet-adapter, reviewed-relayr-hooks |
| Current wallet | Generic actions, batches, Relayr, Safe signatures and Safe queue execution accept same-account connector replacement and resolve the current client; account, chain, Safe route and view-as checks remain. | reviewed-safe-signature, multichain-batch, safe-queue-card, current-wallet-adapter, existing Relayr boundary matrix |
| Chain-qualified identity | Shared identity uses chain+address for custom assets, authenticates USDC on its chain, and flattened token rows plus shield denomination retain chain. Real activity, floor and participant aggregation consume the shared rule. | token-identity, project-link-preview, shields-route |
| Reserved single supply | Existing compiler rejects supply1 with positive reserves, including per-chain override; historical new authorizations use the same deadlock predicate. | add-items-modal, shop-voting-policy |
| Unknown balances | Existing payment balance reads/layout preserve unread values; treasury previews now report unavailable and shield numeric totals stay null on unread amounts. Confirmed zero remains zero. | pay-card-layout, you-card-balance-availability, project-link-preview, shields-route |

Source review: independent parent review approved the final policy owner. Focused wallet/policy recovery run passes285 tests; nested Safe/MultiSend/forwarder and historical launch tests pass5 tests. All checks use Node26.12.1 and physically copied dependencies matching the existing package lock. Final full coverage, production build and browser results will be recorded below. No contracts, original dirty checkout, deployment, push or merge changed.

## Plan refinement
- **Objective:** Finish the authorized five-rule convergence with a measured budget allowance for the necessary shared shop authorization guard; preserve all correctness and recovery policies.
- **System fit:** The same runtime artifact passes build and standalone checks and is undergoing170 browser cases; the bundle fixture owns bounded acceptance ceilings. The parent approved measured cap updates, not policy removal or deployment.
- **Reuse and simplicity:** Keep the existing shared ABI decoders, tiny reserve policy owner and lazy loading. Stop loading rearrangements and code-golf; update only seven ceilings that the exact artifact exceeds.
- **Evidence and unknowns:** Actual gzip KiB: create550.8,slug579.2,terms577.8,shop585.4,extras595.2,account424.3,allclient2757.6. Necessary shared authorization guard adds3.6KiB over the aggregate ceiling, about0.13%; referenced911.8 remains below922, discover339.3 below340 and operator673.6 below676.
- **Verification:** Set rounded caps to551/580/578/586/596/425 and aggregate2758KiB, rerun budget on the exact existing artifact, finish static and browser checks, then commit only owned files. Report the narrow baseline increase transparently.
- **Resource budget:** One bounded measured fixture update, no further loading/code changes or artifact rebuild. No contract, deployment, push or merge.


## Final verification and limits
- Full source-frozen coverage:2846 tests across287 files passed, exit0, pinned Node26.12.1, two workers and no cache. Subsequent behavior-preserving loading/domain extraction passed443 wallet/recovery tests and296 focused compiler/policy tests; the final bundle checker passed13 regression tests.
- Final typecheck, lint, format ratchet, source invariants, dead-code check and wallet inventories pass. Dependency integrity, environment/deployment fixtures and production advisory audit pass. All44 protocol artifacts independently matched the exact pinned deploy-all-v6 revision.
- Final production build and standalone validation pass. Approved measured caps pass on that exact artifact:2757.6/2758KiB all client JS and911.8/922KiB referenced JS; six route caps are rounded up as documented in the checker. This is an explicit narrow baseline update for the necessary authorization guard.
- Browser full run:158 passed,10 intentional viewport skips,2 flaky composite-route tests, so CI failOnFlaky correctly returned exit1. Both composite cases passed retry. Their unchanged case then passed all5 viewports in an isolated one-worker run with retries0 and the original30s timeout (36.6s total). The full run is not claimed clean; exact-head GitHub full-browser CI remains required independent evidence before release. First-run traces are preserved at /private/tmp/rn-browser-first-run-results.
- Independent parent review approved the policy source. No contract edits, original dirty-checkout edits, deployments, wallet transactions, pushes or merges occurred.

## Plan refinement
- **Objective:** Fix Astra's actual wagmi acquisition race in RN111 so same-account connector replacement invokes the current provider without relaxing reviewed account, chain, Safe route, payload or recovery checks.
- **System fit:** Existing reviewed-send-deps WalletAdapter owns final client acquisition and invocation for direct writes, approvals, signatures and batches. Installed SDK and contracts remain unchanged; pre-invocation failures must release definitely-unsent journal reservations while actual wallet failures remain ambiguous.
- **Reuse and simplicity:** Replace the SDK viem adapter delegation with one local callback helper using explicit current connector acquisition, bounded UID-drift retries and synchronous validation/invocation in the same continuation. Preserve native chain formatters, ready/switch semantics and existing shop policy checks.
- **Evidence and unknowns:** /private/tmp/astra-wallet-race.mjs reproduces current=connected but old=invoked with installed wagmi and SDK. Existing mocks switched before client acquisition and missed the await race; SDK cleanup recognizes4001 only, so the app must classify strictly pre-invocation errors without retagging actual wallet errors.
- **Verification:** Add real wagmi provider/chain acquisition holds that switch connector mid-acquisition for transactions, typed/message signatures and sendCalls; account/chain/Safe drift must invoke nothing. Exercise SDK rejection rollback for acquisition failures and preserve ambiguous wallet errors. Freeze source before owning full gates and independent Astra re-review.
- **Resource budget:** One adapter owner and durable focused regression file, max2 workers and pinned Node26 with physical dependencies. Reuse existing policy/recovery tests, no broad census, dependency/SDK/contracts changes, merge or push. Measure any necessary bounded artifact footprint only after source freeze.

- [x] Implement callback-based current-wallet invocation and real-acquisition regressions.
- [x] Freeze source, obtain Astra review and complete local preflight; exact-head full CI remains required before merge.
- [x] Commit reviewed changes and report exact proof and limits to parent.

## Plan refinement
- **Objective:** Finish only the reproduced acquisition race and necessary final existing guards, readable refusal and unsent recovery, then freeze for Astra and required gates.
- **System fit:** A private pre-invocation write brand supplies SDK4's4001 rollback signal; send/resume engine wrappers normalize it only after cleanup so React shows the real reason. Signatures receive no4001. The existing fee-attempt restore branch recognizes the private brand while retaining signed quote history.
- **Reuse and simplicity:** One adapter callback helper plus narrow engine bridge; no SDK release. Capture each action's existing synchronous final assertion when that action reaches the adapter, rather than applying every active action's assertion to unrelated sends. Standalone adapters accept an optional final callback for existing fee/context checks.
- **Evidence and unknowns:** Actual SDK signPrepared rewrites4001 into cancellation, and React useReviewedRun hides it too. Real tests now demonstrate correct current-provider invocation, SDK unsent rollback, signature refusal text and ambiguous invoked-wallet errors; final action assertion plumbing and fee recovery have bounded owning tests.
- **Verification:** Require actual React same-call retry after acquisition refusal, actual signReviewed reason preservation, actual fee journal restoration with signed bytes unchanged and a held-acquisition final-assertion refusal. Freeze all source before full gates and Astra review.
- **Resource budget:** No new feature census, cleanup or optimization. Finish the identified owner plumbing, final review and bounded required artifact measurement; no push before parent coordination and Astra approval.

Astra approved the frozen runtime fix after independent27/27 acquisition/SafeBatch tests and1/1 fee-restoration test. Approved SHA256: reviewed-send-deps.ts31deb9b63c39540439f716e5632ba3d95aa660099ab71c39b81c6dfe3bd4acfd, useReviewedAction.tsf4c693b6f634106b3c9ae02a3eecf42f34898fb2d47d19aab431089ec66eda03, useReviewedRelayr.tsf06e8453358b1a770d6b1b54b174001ceeeb1b1d25fefcdd34d4796d378bd12d. Final owning focused run passes458 tests. Full source-frozen gates use pinned Node26.12.1 with CI's NODE_OPTIONS=--no-experimental-webstorage, physical locked dependencies and at most2 workers.

## Plan refinement
- **Objective:** Complete only the approved acquisition-race fix with the minimal measured bundle allowance needed by its callback and cleanup/UX bridge.
- **System fit:** The Astra-approved runtime artifact builds and passes standalone validation; existing bundle-checker ceilings own the acceptance baseline, while exact-head CI will own final full coverage/browser proof before merge.
- **Reuse and simplicity:** Keep frozen runtime source and the existing checker. Update only create552, terms579, shop587 and aggregate 2760KiB; no new loading rearrangements, source optimization or rebuild.
- **Evidence and unknowns:** Measured gzip KiB are create551.4, terms578.4, shop586.0 just over586, aggregate2759.3 versus prior artifact2757.6. The required callback/unsent UX fix adds1.7KiB total; referenced912.4 remains below922 and every other route passes.
- **Verification:** Rerun the checker against the same artifact and its13 regression tests, preserve Astra's three source hashes, commit the candidate with honest local targeted/static/artifact evidence and require exact-head full CI before merge.
- **Resource budget:** One approved measured baseline update, no further source edits, feature census, optimization, dependency/SDK changes or local full-suite repetition. Parent coordinates publication and landing.


Acquisition-fix review: 458 focused tests across 8 owning wallet/recovery suites pass, plus 13 bundle-checker regressions. Final typecheck, lint, format ratchet, source invariants, dead-code and both wallet inventories pass. Astra independently approves the three exact runtime hashes recorded above and passed 27 acquisition/SafeBatch plus one fee-restoration test. Build and standalone preflight pass. The exact artifact passes approved narrow caps at 2759.3/2760 KiB all client JS and 912.4/922 KiB referenced JS. No runtime source changed after Astra approval. The partial local full-suite run was intentionally stopped, not counted as proof, when the parent chose focused/static/artifact preflight followed by required exact-head full CI before merge. No contracts, SDK, dependencies, original dirty tree, pushes or merges changed in this agent's continuation.


# Align pricing, loan units, inventory validation and homepage identity — 2026-10-26

## Plan refinement
- **Objective:** Correct exactly the four confirmed client bugs without changing contract economics or adding friction: accurate shop currency labels, source-token loan units, effective-chain stock validation and authenticated native/USDC homepage grouping.
- **System fit:** Artifact-bound hook pricing currency/decimals are independent of accepted token; REVLoans reads sourceToken accounting context; hook store enforces effective reserve supply; terminal identity is chain+token. UI/schema/display use these existing meanings. Unknown custom context remains unknown and recovery/review flows remain intact.
- **Reuse and simplicity:** Configuration owner extracts/reuses creation pricing with SDKresolve721PricingContext and existing issuance label, then feeds schema/compiler/labels consistently. Data owner reuses tokenUtils/existing loan source reads for exact source metadata and canonical classification. Disjoint changes, one home per rule, no parallel copies or dependency upgrades.
- **Evidence and unknowns:** Parent verified4key sources against Ethereum metadata; Astra verified6sources across4mainnets(24matches), SDK4addresses(all24) and hook conversion library. This verifies recorded artifact/source alignment, not liveRPC bytecode. ExistingETH1/18 encoding andUSD6 SDKprecision retained; native token-keyedcurrency61166 is not ETHpricingdenomination1.
- **Verification:** Renderedform/schema/encodedprice regressions across ETH/USD/custom/mixedaccepted, selected/inactivechain overrides, mixed-token actual loan rows/fees/actions and unknownsource handling, canonicalnative/USDC versus symbol/addresslookalikes with unchangedUSDtotals. Focused Node26tests/static/build/budget, separateAstra finalsource review and mandatory exact-head fullCI before any landing.
- **Resource budget:** Two disjoint fix owners max2workers, absolute paths/explicitworkdirs; parent owns this taskrecord. No othercensus, contract/SDK/package changes, newconfirmationflows, deployments orwallettransactions. Use focused local proofs and one required fullCI run rather than redundant full local suites.

- [x] Share contract-backed creation pricing and validate effective selected-chain supplies.
- [x] Resolve loan units/actions by exact source and authenticate homepage asset grouping.
- [ ] Complete focused tests, Astra review, static/artifact gates and reviewable PR.

Review: Independent Astra approved all ten runtime files, including final formatting/type-only changes (approval artifact SHA256 d44aab58d85f9d432e935952bbb406b17de5947275f925ac01633f416be88d8f). Astra independently passed 77 focused tests; parent final changed suites passed 41 tests. Sixteen valid launch configurations retained byte-identical calldata, SHA256 b0d9a956b653d131226baae90b20952ecd5ae02fd445c820048aa2485ead9006. Contract/source/SDK evidence covers six sources across four mainnets, plus all 44 pinned deployment artifacts; no live bytecode attestation is claimed. Typecheck, formatter ratchet, source invariants, wallet inventories, dead-code, dependency integrity, environment/deployment fixtures and production audit pass. Build/artifact and exact-head CI remain final gates before landing. No contract, SDK or dependency changes.

## Plan refinement
- **Objective:** Complete the four approved fixes with the minimal measured per-route bundle baseline adjustment.
- **System fit:** Keep all ten Astra-approved runtime files frozen; the existing artifact checker remains the size gate and exact-head CI remains the release proof.
- **Reuse and simplicity:** Reuse the existing integer-ceiling policy; round only home to394, project to581, terms to580 and extras to597 KiB. No source optimization, dependency change or new mechanism.
- **Evidence and unknowns:** The built artifact measures393.0,580.0,579.2,596.1 KiB on those routes, slightly over their existing caps. All client JS2759.9 versus prior2759.3 stays within2760; referenced912.5 stays within922. Measurements are local, CI still pending.
- **Verification:** Rerun the unchanged artifact checker and its existing regression suite, obtain Astra allowance review and require final-head full CI. Preserve runtime approval hashes.
- **Resource budget:** One narrow measured baseline update, no rebuild locally or expanded census; use existing full CI for final browser/coverage proof.

Artifact review: production build and standalone pass. Exact artifact budget passes at2759.9/2760 KiB aggregate and912.5/922 KiB referenced after four sub0.3KiB route overages are rounded to the next integer ceiling. Independent Astra approves those four caps; runtime hashes remain unchanged. PR112 full CI is the final coverage/browser/container gate.

# Client recovery identity and availability — 2026-10-27

## Plan refinement
- **Objective:** Truthful unavailable homepage data and permission-query error/retry presentation with fail-closed writes. Fix only the reported client issues and prepare reviewable changes.
- **System fit:** Client helpers own chain-qualified sequence identity and explicit unavailable versus valid-zero data; permission reads remain fail closed. SDK and contracts are unchanged.
- **Reuse and simplicity:** Reuse existing domain owners, sequence/recovery primitives and React Query refetch; no dependencies or redundant helpers. Parent alone writes task notes, disjoint owners coordinate shared checkout.
- **Evidence and unknowns:** Current main is pinned in this isolated checkout; prior actual-consumer proofs reproduce the failures. Preserve unrelated dirty originals and exact legacy pending records, including records belonging to other chains.
- **Verification:** Focused actual-consumer regressions cover failure, retry, real zero and successful results plus safe legacy recovery. Independent Astra review and final static/build/artifact checks precede exact-head full CI.
- **Resource budget:** Node26/npm12 physical locked dependencies, max2 workers per app, stagger heavy builds. No SDK overlap, broad census, contract changes, transactions or inferred merge authority.

- [x] Implement scoped fixes with meaningful regressions.
- [x] Complete independent review and preflight.
- [ ] Publish reviewable changes with exact-head CI evidence.

Artifact baseline note: final RN build passes every route, referenced total (913.1/922 KiB) and vendor/lazy boundary. Aggregate measures 2760.4 KiB against 2760, approximately 0.5 KiB above prior main. Round only the aggregate ceiling to 2761 KiB; keep all other checks and approved runtime source unchanged. Independent Astra allowance review and same-artifact rerun are required before publication. This is a measured baseline adjustment within the existing artifact-verification plan.

Review: Permission reads expose failure and retry while retaining fail-closed grants and independent inventory authority checks. Homepage metric/history availability is explicit and independent; real empty stays zero. Independent Astra passed 51 focused tests. Full type/lint/format/source/wallet/dead-code/environment/deployment/protocol/audit/build/standalone checks pass. Artifact referenced 913.1/922KiB and aggregate 2760.4/2761KiB pass with only the independently approved 1 KiB aggregate rounding; 13 checker regressions pass. Approval artifact SHA256 15c5b8cf42b8ffd6c8582ef4d2d8c0a998da2d43a899decea59e3afff7fcc67f. No contract, SDK or dependency changes. Final-head full CI remains required for publication evidence; no new merge authority inferred.

## 2026-11-05 Balance tooltip layout
- [x] Header balance tooltip: chain names instead of ids, three-column grid (chain, token amount, USD), no pipes or brackets, width fits content. One file: src/app/[slug]/components/Header/TvlDatum.tsx. Verified: typecheck, lint, 16 header tests, screenshot on /eth:1.

# revnet.money UX review fixes, 2026-11-06

Source: decisions jango recorded on the review page (41 Fix, q12 Skip). Evidence: /Users/jango/Documents/jb/v6/evm/.ux-review/revnet-money/ (stories/STORY-NNN screenshots, ux-walker/all-findings.md). F-NNN-N is STORY-NNN.

## Plan refinement

- **Objective:** Fix all 41 issues jango marked Fix on live revnet.money behavior, honouring each note, with no wallet-write regressions. q12 was skipped on a wrong answer and is now in scope (stream B): keep the 256 limit but stop cutting silently, on both the Pay note and the payer default memo.
- **System fit:** Outcome is a trustworthy anonymous and holder experience. Owners are the revnet client components plus shared formatters and chain constants; juice-sdk is touched only if a rule already lives there. Wallet write authority and contracts are unaffected. Learning goes to tasks/lessons.md and the parity check to sibling clients.
- **Reuse and simplicity:** Grep first and reuse the existing formatter, chain constants, skeletons and table container. Copy juicebox-money search presentation for b01. New shared owners only when a rule has several copies, moving every caller.
- **Evidence and unknowns:** Walk evidence is anonymous and live; connected-wallet behavior is untested, so b08 must be reasoned from source. b04 and b06 root causes are unknown until read against live RPC and metadata. Local dev may not show real Bendystraw data.
- **Verification:** Per stream typecheck, lint, focused vitest plus a regression test per behavior fix. After integration, full `npm run check` on Node 26 and rendered desktop and 390px checks of changed surfaces. Then a cross-client parity pass against juicebox-money.
- **Resource budget:** Seven streams on disjoint files in separate worktrees, integrated by the main session into fix/ux-review-20261106. A stream reports rather than edits when it needs a file another stream owns. Replan if a root cause needs a contract or SDK release.

## Items

### Stream A: Search, navigation, not-found, focus

- [x] **b01** Search results hide the names
  - What: Type in the nav search and each row shows only a ticker and chain logos. The name is painted in the same colour as the panel, so a search for "banny" returns four logos and no text. Account rows hide the ENS name the same way. Four separate test runs hit this.
  - Likely fix: Set an explicit text colour on the result name in the search dropdown, then add a visual regression test.
  - Where: src/components/layout/RevnetSearch.tsx. Findings: F-001-1, F-015-1, F-057-2, F-075-1, F-061-2
  - NOTE: jango: see how juicebox money does it, copy. Make it pretty with enough context for the user, keep it simple.
- [x] **q06** Reduce the 44px left padding or shorten the placeholder at phone width
  - Where: layout/RevnetSearch.tsx. Findings: S12 (F-009-6, F-061-1, F-068-4, F-080-1)
- [x] **q17** Escape closes the search list without clearing the input
  - Where: layout/RevnetSearch.tsx. Findings: F-081-5
- [x] **b18** Not-found page is a dead end
  - What: Bad handles, slugs and account ids all render "Revnet Not Found" with one button, no nav and no search, and nothing says what failed.
  - Likely fix: Keep the nav and search on the page, and name what was not found.
  - Where: src/app/not-found.tsx. Findings: F-004-1, F-059-1, F-075-2
- [x] **q10** Make "Return Home" a single `<a>`, add an h1, set the document title
  - Where: not-found.tsx. Findings: F-075-4, F-059-3
- [x] **b16** Phone tab bar hides the active tab
  - What: At 390px, the tab row opens scrolled to the start, so on an Owners or Shop link the active tab is off-screen. Phones also land on the activity feed rather than Overview for the same URL.
  - Likely fix: Scroll the active tab into view, and decide which view phones open on.
  - Where: src/app/[slug]/components/ProjectMenu.tsx. Findings: F-033-02, F-041-1, F-024-1, F-008-4
- [x] **q16** Add `aria-current` on tabs and `aria-pressed` on legend and stage pills
  - Where: ProjectMenu.tsx, TokenPriceChart.tsx. Findings: F-014-5, F-024-2, F-011-3, F-037-04
- [x] **b17** Keyboard focus gets lost
  - What: Escape on the Sign in sheet drops focus to the page body. The sheet can lose focus so typed text goes nowhere until you click the field. Project pages take 34 Tab presses to pass the feed and reach Overview, with no skip link. Chart term tooltips work by mouse only.
  - Likely fix: Restore focus after sheets and menus, add a skip link to every page, and make tooltips reachable by keyboard.
  - Where: src/providers/ParaAuthSheet.tsx, project layout. Findings: F-081-1, F-081-2, F-021-1, F-062-1, F-013-3

### Stream B: Pay card, cart, shop

- [x] **b02** "Card or bank" quotes dollars as ETH
  - What: Choose Card or bank and type $25. The Pay card previews 8,804 REV, which is the quote for 25 ETH. At the live rate $25 buys about 3.9 REV, so the figure is about 2,275 times too high. It happens on Ethereum, on Base and at phone width. Related: a chosen USDC silently resets to ETH on a chain switch, and an old quote stays bright green for 4 to 8 seconds while a new one loads.
  - Likely fix: Convert the dollar amount before quoting, or hide the receipt until it can be converted. Keep the chosen token across chain switches and dim stale figures.
  - Where: src/app/[slug]/components/v6/pay/V6PayCard.tsx. Findings: F-020-1, F-019-1, F-017-1
- [x] **b05** Shop cart is lost on a chain switch and its quote lags
  - What: With an item in the cart, clicking a header "On:" chain link empties the cart with no notice. The Pay card's own Chain select keeps the old amount (102 ETH) over an empty cart and quotes tokens for nothing. The "You get about" preview runs one cart change behind: 2 ETH of items showed the 1 ETH quote. The checkout bar sits after the last of 68 cards.
  - Likely fix: Keep the cart across chain routes, derive the amount from the cart in one place, and pin the receipt while the cart has items.
  - Where: Cart provider, V6PayCard, shop/InventorySection.tsx. Findings: F-048-1, F-043-1, F-043-2, F-043-4, F-047-2
- [x] **b06** Most BAN shop items have no name
  - What: 49 of 68 items on the BAN shop show as "Item #N", and 12 of those have a blank tile. No retry line ever appears, so a shopper cannot tell a broken item from an unnamed one. The same ids leak into the Customers list and the Replace media selects.
  - Likely fix: Find why the item metadata does not load, add a retry, and say so when details are missing.
  - Where: Shop inventory. Findings: F-042-1, F-046-1, F-041-2
- [x] **q05** Divide Voting units by 1e18 before display
  - Where: shop/TierDetailModal.tsx. Findings: F-042-3
  - NOTE: jango: check with contracts. Checked: JB721TiersHookStore.sol:693 returns custom units (uint32) when flagged, else the tier price, and the read exposes no flag. Hide the row when units equal the price, show the raw custom number otherwise.
- [x] **b10** Balance reads $0.00 when the price fails (ONLY: pay-card half (red Payments are off during pending reads))
  - What: On one load the ETH price failed and the header read "$0.00 balance" for a revnet holding 0.346 ETH. Only a hover tooltip says No USD price. It was intermittent and recovered minutes later. Similarly, a cold load of Artizen shows a disabled Pay card with a red "Payments are off" for about 5 seconds before everything resolves.
  - Likely fix: Show the ETH balance when the USD price is missing, and show loading instead of an error while reads are pending.
  - Where: Header/TvlDatum.tsx, V6PayCard. Findings: F-004-3, F-011-4, F-018-2
- [x] **q19** Single-column dialog grid and nowrap selection bar at 390px (ONLY: selection bar half)
  - Where: BridgeDialog.tsx, shop/InventorySection.tsx. Findings: F-029-05, F-047-1, F-027-04
- [x] **b19** Loading looks like failure (ONLY: shop half)
  - What: "(balance unavailable)" appears while balances load. /discover flashes "No matching revnets found" before results arrive. The shop runs a 6 to 10 second skeleton before saying it has no items.
  - Likely fix: Separate loading from failed states across these surfaces.
  - Where: Cross-cutting. Findings: F-037-01, F-007-2, F-041-2, F-017-1

### Stream C: Holder dialogs and account

- [x] **b08** Cash out and Move dead-end under View as
  - What: Viewing as a holder with no wallet, Cash out and Move between chains never show an estimate, and typing a valid amount silently disables the only button. The Move dialog keeps saying to choose networks after both are chosen. New loan is narrower: it quotes correctly and only disables silently when the quote is zero. Connected wallets were not tested, so this may only affect View as.
  - Likely fix: Quote with the viewed address, and never disable the button without a sentence saying why.
  - Where: src/components/ButtonWithWallet.tsx, RedeemDialog, BridgeDialog. Findings: F-027-01, F-029-03, F-058-1, F-028-01
- [x] **q02** De-duplicate the "To network" options
  - Where: Value/BridgeDialog.tsx. Findings: F-029-01
- [x] **q14** Show chain name and short loan id in the Refinance "Current loan" box
  - Where: Value/ReallocateDialog.tsx. Findings: F-032-04
- [x] **q19** Single-column dialog grid and nowrap selection bar at 390px (ONLY: BridgeDialog half)
  - Where: BridgeDialog.tsx, shop/InventorySection.tsx. Findings: F-029-05, F-047-1, F-027-04
- [x] **q08** Suppress the "This is you" badge while View as is active without a wallet
  - Where: AccountHeader.tsx, useViewedAccount.ts. Findings: F-058-3, F-026-01
- [x] **q09** Keep the full address as the subtitle on the address route; never repeat the h1
  - Where: AccountHeader.tsx. Findings: F-003-1, F-058-2
- [x] **b12** Account rows leave the site, and payer addresses cannot be copied
  - What: Holder, customer, borrower and operator cells open Etherscan or Basescan in a new tab, though the site has an account page for each. The payer address table shows only a shortened link with no copy control, so a treasurer cannot copy the address on the site. Five stories took 5 to 6 actions against an ideal of 1 to 3.
  - Likely fix: Link account cells to /account/<address>, and add a copy control to payer addresses.
  - Where: Owners, Loans and Extras tables. Findings: F-064-1, F-025-05, F-045-1, F-057-1, F-022-1

### Stream D: Shared formatting, chain names, tables, terms

- [x] **b13** Raw numbers throughout
  - What: 18-decimal amounts, floats and scientific notation appear across tables and tooltips: 1,130,130.258069698905346873 REV, 5.36e-6 ETH, 540.3599853515625. One balance can print with 2, 6, 8 and 18 decimals on the same page. Cash out tax reads 0.1 where the chart says 10%.
  - Likely fix: Route every token and price through one shared formatter.
  - Where: About 20 stories, shared formatter. Findings: F-034-03, F-038-03, F-042-3, F-013-1, F-035-05
  - NOTE: See q01: cash out tax stays 0 to 1, so the chart must change, not the table.
- [x] **q01** Render cash out tax as a percentage ("10%") in the Stages table
  - Where: terms/components/StagesTable.tsx. Findings: F-013-1
  - NOTE: jango OVERRIDES the listed fix: cash out tax is a value 0 to 1, never a percentage. Render 0.1, and remove every place that expresses the tax as a percent, including charts, tooltips and create copy. A percentage is only a derived figure from the curve formula.
- [x] **q03** Format the donut tooltip balance and say "REV", not "tokens"
  - Where: owners accounts donut component. Findings: F-034-03
- [x] **q04** Format Amount and "Tokens backing loan" with the shared token formatter
  - Where: auto issuance table, LoansDetailsTable.tsx. Findings: F-038-03, F-039-02
- [x] **q15** Format "5.36e-6 ETH" with the price formatter
  - Where: market pool card. Findings: F-035-05
- [x] **b14** Chain names and order change by screen
  - What: The header says Optimism and Arbitrum. The Pay card, You table and distribute checkboxes say OP Mainnet and Arbitrum One. One project page orders the chains three ways, and nothing marks the chain you are viewing.
  - Likely fix: One owner for chain names and order, plus a marker on the current chain.
  - Where: Shared chain constants. Findings: F-018-1, F-009-4, F-010-1, F-037-02, F-033-03, F-009-7
  - NOTE: jango: do not mark the current chain anywhere. The project should feel like one unified project across chains. Only unify names and order.
- [x] **b15** Tables overflow with no sign they scroll
  - What: Stages, Loans, Auto issuance, Splits, Holders and others sit in scroll boxes with no visible cue. The Stages table is 938px in an 819px column, which hides Cash out tax. On a phone, the loan Repay and Refinance actions are entirely off-screen.
  - Likely fix: One responsive table container with a visible scroll cue, or collapsed columns at phone width.
  - Where: Shared table container. Findings: F-013-2, F-032-01, F-038-02, F-039-01, F-036-03
- [x] **b03** Holders table is out of order and Paid is always 0
  - What: The footer says ranked by balance, but 14.092% sits above 15.775% and 0.644% above 0.956%. The Paid column reads 0 ETH for all 232 holders, including accounts paying in the feed beside the table. Pages 4 to 8 show 0% on every row.
  - Likely fix: Sort on the combined balance across chains and fill Paid from real payment totals, or remove the column if the data does not exist.
  - Where: Owners accounts table. Findings: F-034-01, F-034-02, F-057-3, F-025-01, F-057-4, F-034-04
  - NOTE: jango: just fix the ordering by balance if that is wrong. Do not build Paid totals; if Paid has no real data, remove the column.
- [x] **b11** Auto issuance links go nowhere
  - What: Distributed rows link to a four-character hash such as etherscan.io/tx/f509, labelled "f509...f509". The links cannot resolve. The table also clips its last column and slices the locked row in half.
  - Likely fix: Pass the full transaction hash to the link, and let the table show all its rows.
  - Where: Auto issuance table. Findings: F-038-01, F-038-02
- [x] **q07** Show "Loading…" while reserved balances load; keep "(balance unavailable)" for failures
  - Where: splits distribute panel. Findings: F-037-01
  - NOTE: jango OVERRIDES the listed fix: use the canonical loading states that do not litter the screen with "loading..." strings. Keep (balance unavailable) for real failures.
- [x] **q13** Checksum both Expected and Actual addresses
  - Where: ProjectDiagnostics.tsx. Findings: F-066-1
- [x] **b22** Price chart has no scale
  - What: The Overview chart has no y-axis, and REV's cash out line sits flat on the baseline where it cannot be read.
  - Likely fix: Add a y-axis or value labels, and decide how to show a line much smaller than the others.
  - Where: TokenPriceChart.tsx. Findings: F-011-1, F-011-2

### Stream E: Market liquidity

- [x] **b04** REV liquidity card fails on all four chains
  - What: After 15 to 40 seconds of skeleton, every chain reads "The RPC could not return the complete pool history, so liquidity is unavailable." There is no retry. Providers, Composition and Depth never rendered in any load. The same subtab also stacks four charts with 24 range buttons, and shows the cash out price for one chain only.
  - Likely fix: Find why the pool history read fails, add a retry, and show whatever partial data did load.
  - Where: Market subtab, AMM card. Findings: F-035-01, F-035-02, F-035-03, F-035-04

### Stream F: Create form

- [x] **b07** First .jb import drops the operator address
  - What: On a freshly opened Create page, importing a draft leaves "Enable limited operator controls" checked with an empty address. Importing the same file a second time fills it. REV's real export reproduced this three times. Its description also arrives as literal HTML tags, and the logo preview does not come back.
  - Likely fix: Set the operator field when the import first renders, convert or strip HTML in the description, and restore the logo preview.
  - Where: src/app/create/form/DeployRevnetForm.tsx. Findings: F-054-1, F-054-2, F-054-3
- [x] **b20** Create form loses or hides what you entered
  - What: "Start the revnet in the future" with no date saves silently and the intent is lost. The stage dialog's error list renders under the Save button, clipped at the edge. The cut setting leaks between stages. Toggling operator controls clears the typed address. A reload wipes the whole form.
  - Likely fix: Validate the start date, move errors into view, and keep a browser draft.
  - Where: src/app/create/form. Findings: F-051-2, F-051-1, F-051-6, F-053-1

### Stream G: Home, header, operator, small copy

- [x] **b09** Home feed amounts are cut to "0.0000…"
  - What: The amount cell in the home Latest feed is 55px wide, so most amounts clip, even 0.00003 ETH. Trending truncates five of eight names, and Top and New show about two rows inside a small inner scroll box.
  - Likely fix: Format amounts to a few significant digits, widen the cell, and let the panels grow to their rows.
  - Where: src/app/HomepageActivityFeed.tsx, TopProjectsFeed.tsx. Findings: F-006-3, F-006-1, F-006-2
- [x] **b10** Balance reads $0.00 when the price fails (ONLY: TvlDatum half (balance with no USD price))
  - What: On one load the ETH price failed and the header read "$0.00 balance" for a revnet holding 0.346 ETH. Only a hover tooltip says No USD price. It was intermittent and recovered minutes later. Similarly, a cold load of Artizen shows a disabled Pay card with a red "Payments are off" for about 5 seconds before everything resolves.
  - Likely fix: Show the ETH balance when the USD price is missing, and show loading instead of an error while reads are pending.
  - Where: Header/TvlDatum.tsx, V6PayCard. Findings: F-004-3, F-011-4, F-018-2
- [x] **q20** Anchor the "Balance by chain" tooltip below its trigger
  - Where: Header/TvlDatum.tsx. Findings: F-009-1
- [x] **b21** Operator tab "Set splits" has no button
  - What: The Edits panel describes setting splits but shows no action for an anonymous viewer, on both revnets walked. Artizen's header also has no Operator row, though Other info names one.
  - Likely fix: Show the action or a state line, and render the operator row whenever one exists.
  - Where: Operator tab, project header. Findings: F-063-1, F-015-3, F-067-1
- [x] **q11** Replace the middot and bullet separators with commas
  - Where: guides/RevnetGuide.tsx, shields route. Findings: F-068-2, F-073-3
- [x] **q18** Pluralise "Across 1 project chains", drop "Suckers bridge" for single-chain revnets, drop the "revnet.eth" byline
  - Where: discover/MiniHeaderCard.tsx, Chains card, Viewing-as menu. Findings: F-045-3, F-067-3, F-007-1
- [x] **b19** Loading looks like failure (ONLY: discover and splits half)
  - What: "(balance unavailable)" appears while balances load. /discover flashes "No matching revnets found" before results arrive. The shop runs a 6 to 10 second skeleton before saying it has no items.
  - Likely fix: Separate loading from failed states across these surfaces.
  - Where: Cross-cutting. Findings: F-037-01, F-007-2, F-041-2, F-017-1

### Integration

- [ ] Merge streams into fix/ux-review-20261106, resolve conflicts, full `npm run check`
- [ ] Rendered desktop and 390px checks
- [ ] Parity pass against juicebox-money
- [ ] Open PR, leave merge to jango
- [ ] Then run the same UX pass on juicebox.money and publish a review page for jango

### Review

All items above were triple checked: symptom real, correct behavior from a contract, live data or sibling with file and line, fix proven by a test or render. Items whose proposal was wrong were corrected, not applied as listed: q01 and b13 (cash out tax stays 0 to 1), q05 (voting units hidden when equal to price, raw otherwise), Move refusing a chain with no surplus (the contract allows it, fork tested).

Not changed, to raise with jango: home panel heights and Trending truncation, account cells opening an explorer rather than /account, HTML in imported descriptions, the first bridge route default, Pay amount digits staying when the token changes.

Gates: `npm run check` steps all pass (3112 unit tests, browser 160 passed, 10 skipped). Two Codex passes: 5 reproduced findings, all fixed with failing tests. The hydration failure on /shop came from the shared inventory read, fixed by holding the skeleton until hydrated.

## State machines wave 1 (2026-11-09)

Discovery: scratchpad `sm/revnet.md` (34 machines). Brief: scratchpad `sm/BRIEF.md`.

## Plan refinement
- **Objective:** Fix the confirmed implicit-state bugs (revnet-1 false loan failure, revnet-2 dead pending branch) and make the listed UNION/DERIVE machines explicit without changing what users see; record SDK-owned items as SDK requests.
- **System fit:** Every send goes through `useReviewedAction` over core's `useReviewedRun`; local status must derive from its `phase`/`held`/`error` rather than copy it. Owners stay the SDK runner and revnet's dialogs; jbm's PayPanel and GetLoanFlow are the sibling consumers named in the cross-client notes.
- **Reuse and simplicity:** Reuse the runner's phases (SDK vocabulary) and existing test harness (`test/support/reviewed-action.ts`). One reducer per flow; refactors are separate commits from fixes. No SDK code is invented locally.
- **Evidence and unknowns:** Bugs are confirmed by a failing regression test before the fix; an item that does not reproduce is dropped with a reason. Installed SDK is nana-sdk-core 6.0.0.
- **Verification:** Regression test per fix; existing suites stay green per refactor; full `npm run check` before the PR.
- **Resource budget:** Disk is tight; node_modules is an APFS clone. Suites run one at a time. Items whose conversion would change visible behavior with no bug are skipped and named.

- [x] revnet-1 loan status derived from the runner (test: borrow-review-cancel "a second loan in the same mounted dialog")
- [x] revnet-2 pay confirm reducer (`payFlow.ts`, test/pay-flow.test.ts); dead pending branch (pay-failure-retry "receipt could not be read")
- [x] Done: 6 (routing review source), 8 (launch payment), 10 (typed repay status), 26 (useSecondsUntil), 32 (loan dialog), 33 (inventory modal)
- [x] Dropped with reasons in the PR: 11, 12, 13, 14, 23, 24, 31
- [x] Gate: every step of npm run check passes except bundle:check (/[slug]/shop 595.1 KiB vs 595 KiB ceiling; origin/main 594.7, delta +0.4 KiB on every [slug] route)

## Review

Two real defects fixed with regression tests (false loan failure on a second loan; a pay card that could trap the payer in pending). The rest are behavior-preserving unions. The shop route is 0.1 KiB over its ceiling; the ceiling was not raised.

## State machines wave 2 (2026-11-09)

- [x] jbm-16 parity: one app-wide `signOutOnce` with a generation in `para-bridge.ts`; `connectParaSession` drops a check a sign-out overtook (test: para-bridge "drops a session check that a sign-out overtook").
- [ ] revnet-9 stopped: Markee already recovers through the SDK's `createSavedAttemptRecovery` (`savedAttempts`); its journal is the domain journal that recovery's `confirmRetirable` re-reads. The React `useSavedAttempt` wrapper would add mount-time recovery and binds one attempt per render, which conflicts with the lost-reply hash typed at Check. Awaiting a decision.
- Bundle: +0.4 KiB on every route against state-machines-2026-11-09; /build 360.2 over 360, route-referenced 922.2 over 922, all client 2775.6 over 2774.

## SDK 6.2.0 adoption (2026-11-10)

## Plan refinement

- **Objective:** revnet on @bananapus/nana-sdk-core 6.2.0: the run wrapper's dismiss, following and onDismissedSettled used where a confirm closes; the pay card freed when its send can't start and closable while a sent payment is only followed; every journal write under a cross-tab lock fenced by that lock, with `locks` handed to every SDK send and sign; wallet answers a lapsed lock refused kept and saved once the lock is free; the wallet adapter forwarding core's fence; one lost-reply hash field shared by Markee and every held write, with jbm #175's wording. Success: full `npm run check` green, failing-first tests, draft PR, not merged.
- **System fit:** User action, useReviewedAction over core's useReviewedRun, browserLocks, journal save (activity store, multichain batch, Markee journal), SDK send or sign under `locks`, wallet adapter fence, hold followed to a verified receipt. The SDK owns run status, dismissal, hold following, lock fencing at wallet boundaries and the Safe Relayr store's saves; revnet owns its journals and wording. Contracts and server routes are unaffected.
- **Reuse and simplicity:** One fence home (`src/lib/fence.ts`: `fence`, `keptOutcomes`), one bound activity journal (`activityJournal(locks)`), one hash field component. No wrapper code to delete: revnet's useReviewedAction already spread the runner.
- **Evidence and unknowns:** Released 6.2.0 dist in node_modules is the authority. The SDK fences SafeRelayr store saves once `withLock` hands it locks; signatures signed under a lapsed authorization lock are never published, so they need no keeping.
- **Verification:** Failing-first vitest per fix (adapter fence, pay card freed and closable, row settled after receipt, onDismissedSettled, Markee sent-step line, each lost-lock fence, each kept wallet answer, the hash field). Then `npm run check` on Node 26.
- **Resource budget:** One worktree (adopt-revnet), sequential edits. Bundle ceiling raises are approved; record any.

- [x] Bump core 6.2.0 (Node 26, npm 12)
- [x] WalletRequestOptions forwarded by signMessage, signTypedData, sendCalls
- [x] Pay card: freed when the send can't start; confirm closes through dismiss while following
- [x] useReviewedAction: rows settled after a held receipt; onDismissedSettled refreshes reads
- [x] AmmCard, RedeemDialog, Markee close through dismiss; Markee says a dismissed sent step is sent
- [x] Fences: activity journal, multichain batch (check, execute, sendDirectCalls), resetUnpaidRoutingDraft, Markee journal with the board key folded in, relayr auth and payment locks, SafeRelayr run(locks)
- [x] Kept wallet answers (hash, definite rejection) for Markee, direct batch calls and the relayr payment
- [x] LostReplyHashField shared by Markee and the account page's held writes
- [x] Full check, push, draft PR

### Review
- `npm run check` (Node 26): dependencies, dead-code, env, deployment, typecheck, lint, format ratchet, source, protocol, wallet-writes and wallet checks pass. In vitest, 321 of 322 files pass. The one failure is the live testnet Bendystraw schema test: `testnet.bendystraw.xyz` times out from here (curl times out after 15 s), so it is external.
- build:browser, standalone:check and bundle:check pass. Ceilings were raised to the measurement, as recorded in `scripts/check-client-bundle.mjs`.
- test:browser: 159 passed and one load timeout (`project-shape` at wide-1100). That spec passes in full at workers=1 (48 passed).
- SDK 6.3.0 will keep lost-lock outcomes itself. When it lands, delete `keptOutcomes` and its uses. The PR body lists them.
- [x] Run wrapper owns its own preparation: a failed Safe peer check or policy chunk returns core's `REVIEWED_ENGINE_LOAD_LINE` as a failed result (nothing sent), so no flow catches it; the pay card's not-started branch and line are gone. Failing-first test through the real wrapper on the burn flow (`test/reviewed-action-not-started.test.tsx`).
- [x] Codex pass 1 #1: a payment whose confirm was dismissed while followed stays pending (Pay disabled); its settlement opens the confirm on the result and clears what was paid. Dismissal test extended through confirmation and closing again (failing first).
- [x] Codex pass 1 #5: an unreadable lost-reply hash says `LOST_REPLY_HASH_UNVERIFIED`, a mismatch only once read. #2-#4 are lost-lock keep cases owned by SDK 6.3.0, listed in the PR body.

## 2026-11-11 — Finish revnet on SDK core 6.3.0

- **Objective:** Move #125 to core 6.3.0 and delete what it owns: `keptOutcomes`, the client hash lines and read-first check, and the pay card's pending-payment hold. Handle `ConfirmationQueuedError`. Recheck Codex pass 1 #2-#4 and pass 2 against 6.3.0.
- **System fit:** Core keeps lost-lock wallet answers (callbacks rerun under retaken locks; `keepOutcome` for the client's own outcome writes), owns the dismissal and own-success rules, and reports `hashCheck`. revnet keeps fenced journals and its wording.
- **Verification:** Regressions through the SDK path with `lapsingLocksForTests`, each seen failing first; full `npm run check`.

- [x] Bump core 6.3.0
- [x] Delete `keptOutcomes`; Markee and batch callbacks are fenced writes core keeps; relayr outcome writes use `keepOutcome`; a late kept hash starts the bundle observer
- [x] Hash field uses `HELD_HASH_*_LINE` and `attachHash(...).hashCheck`
- [x] Pay card: client pending hold deleted for the SDK dismissal rule; a Safe proposal is not dismissed
- [x] `ConfirmationQueuedError` from `ended()` returns `CONFIRMATION_QUEUED_LINE`
- [x] Full check, push, Codex until MERGE


# 2026-11-12: Adopt Node 26.13.1 security release

## Plan refinement
- **Objective:** Move revnet development, CI and applicable production build/runtime to Node26.13.1, with executable checks passing on the exact reviewed change.
- **System fit:** Runtime selection belongs to existing .nvmrc, package engines, CI setup and any OCI base image. Wallet authority, protocol data, SDK ownership and application behavior remain unchanged. User authorized this runtime upgrade; main merge is coordinated by the root agent after review and checks.
- **Reuse and simplicity:** Update existing pins and runtime consistency guards, preserve the independently pinned npm12.0.1 and existing install-script policy, and reuse the full CI suite. Keep dependency versions and resolved lock entries unchanged, modifying only lockfile root engine metadata where required. Preserve historical measurement records.
- **Evidence and unknowns:** Current origin/main was fetched into an isolated worktree; official Node release evidence confirms26.13.1 is a security release. Verify the official OCI digest where used. Local static checks establish configuration agreement; GitHub CI establishes Linux build/test compatibility, not live deployment.
- **Verification:** Run plan checker, diff whitespace and runtime consistency review, existing lightweight deployment/container checks, then full existing CI including coverage/browser and OCI smoke where configured. Investigate failures without weakening checks or increasing existing deadlines. Confirm dependency-lock package entries unchanged.
- **Resource budget:** Reuse GitHub CI for expensive Linux checks and avoid overlapping local builds with service verification. All commands use this absolute worktree and journal writes use absolute paths with a snapshot. Escalate concrete incompatibility to root for replanning.

- [x] Read required workspace resources, descendant instructions and relevant lessons; inspect current-main runtime configuration.
- [x] Update exact runtime pins and matching active documentation/guards.
- [x] Verify minimal lock metadata change and local configuration checks.
- [ ] Prepare PR and verify full existing CI on its exact head.

## Review
Runtime and deployment-policy checks pass under verified Node26.13.1. All non-root lockfile package records are unchanged. The official multiarchitecture Docker index digest was independently rechecked on2026-11-12. Full Linux CI is required on the PR head before merge.


## 2026-11-13: Trusted-site Safe API through Center

## Plan refinement
- **Objective:** Center keeps SAFE_API_KEY server-side and proxies Safe Transaction Service requests from its existing trusted sites; revnet and juicebox.money use the proxy, eliminating browser-key setup. Success includes authenticated upstream calls, exact response/status propagation and no key exposure.
- **System fit:** Existing Center /v1 origin policy and Store budgets govern the new narrow proxy; SDK owns Safe endpoint selection and retry behavior; both client roots opt into their existing Center environment. Signing, Safe hash verification and execution stay in existing owners. Deployment/key configuration are separate from tested local code; user supplies key via server environment.
- **Reuse and simplicity:** Reuse fixed Safe chain prefixes and existing origin/rate-limit/body/fetch patterns. Add a narrow SDK configuration point rather than app-local Safe transports or persisted localStorage mutations. No arbitrary target URLs, no new dependency, no server-side transaction signing.
- **Evidence and unknowns:** Current origin/main Center f6b033b and SDK641e385 are newer than dirty local checkouts; use isolated worktrees. Installed SDK requests directly and retries monthly429. Safe API docs confirm bearer auth and account quotas. Center trusts exact configured origins; origin checks are browser policy, not cryptographic caller authentication, so shared/per-client limits remain necessary.
- **Verification:** Proxy tests cover allowed/denied origins, endpoint/method/path validation, credential forwarding and non-disclosure, redirects, upstream errors, size/time limits and budgets. SDK tests cover opt-in routing, preserved default/custom routes and monthly-quota no-retry. Run relevant checks and both full client suites before any proposed push; no publishing or main pushes without approval.
- **Resource budget:** Delegate Center implementation and SDK implementation separately after this plan gate; parent integrates paired clients and reviews boundaries. Reuse dependencies only with matching lockfiles; serialize heavy gates. Replan on missing auth/hosting capability rather than broadening proxy access or exposing the key.

- [ ] Implement and test bounded Center Safe proxy.
- [ ] Implement SDK opt-in routing and quota retry handling.
- [ ] Integrate revnet and juicebox.money together, verify with candidate SDK.
- [ ] Review changes and document exact deployment/key activation steps and outstanding authorization.


## Plan refinement
- **Objective:** Route every Safe service call through Center while preserving lazy loading on pages without Safe features.
- **System fit:** SDK remains transport owner; one local configured re-export module supplies the existing SDK API to browser and server callers, before requests execute.
- **Reuse and simplicity:** Reuse safe-service-config and replace direct SDK imports with that owner; remove eager root bootstrap and duplicate authority bootstrap. No new transport or asynchronous initialization.
- **Evidence and unknowns:** Full revnet candidate tests3168 passed but eager root config added approximately20KiB to static route bundles. Actual rebuilt route budgets will determine success.
- **Verification:** Enforce configured import boundary in source checks; retain browser/server first-read routing tests; rerun full consumer checks and measure budgets without blanket increases.
- **Resource budget:** Import rewrites only, bounded frontend gates; preserve all SDK candidate code and other bot work.

### Safe proxy verification and release
- User authorized merges and automated SDK version PR publication. Center111 and SDK308 merged; generated versionPR310 now merged for core6.7.0.
- Normal merges retain otherbot revnet131 implementation and budget corrections. No non-SDK lock or installed manifest changed for candidate.
- Final combined candidate check passed static/type/lint/source/protocol/wallet gates,330files/3170tests withcoverage, production browserbuild, standalone packaging and all bundle limits after rounded owner638KiB/extras619KiB measurements. Browser gate passed160tests with10existing viewport skips.
- Eager root configuration was replaced by one configured local service re-export; direct callers and SDK review/recovery owners initialize it before network calls. Source check enforces this boundary, and browser/server first-read tests prove Center routing without client Authorization. Static and aggregate bundle ceilings unchanged.
- Actual published6.7 dependency/lock update and final PR CI remain pending publication.

- Installed published6.7.0 from npm with npm12.0.1/Node26.13.1. Candidate comparison: only package.json differs, all productionfiles identical; nonSDKlockentries unchanged. Dependencies/types/source checks and7focused first-read/lazy-peer tests pass against installedregistryartifact. Latest main6405a16 merged normally with zero resultingfiledelta from testedbranch.

## 2026-11-14: Shop item actions, contracts warning, launch defaults (R6)

- [x] Shop: the item dialog that replaces media also edits the name and description, sets the discount and removes the item, each per chosen chain and item.
- [x] Revnet page: the unknown contracts warning juicebox.money shows, from the SDK's `auditProjectContracts`.
- [x] Create: stage defaults match juicebox.money (no cut, cash out tax 0.1). The pay route choice calls the SDK's `prepareBestUserPay`.

## Plan refinement
- **Objective:** A revnet operator can make the same item changes juicebox.money offers, a visitor sees the same contracts warning, and a new revnet starts from the same defaults. Rulings 2, 3 and 4 of 2026-11-14.
- **System fit:** One item dialog (`EditItemMediaModal`, `mode`) keeps the per-chain item choice, live guards, saved-batch recovery and write gate for all four changes. The reader (`readMediaEditSource`) takes the change and checks its own permission: metadata 25, discount 27, adjust tiers 24.
- **Reuse and simplicity:** SDK `editShopMetadataDetails` (moved from juicebox.money), `auditProjectContracts`, `prepareBestUserPay`. No new dialog, hook or send path. The four entries show under the one existing metadata-rights gate; each dialog refuses a missing permission.
- **Evidence and unknowns:** `REVDeployer` grants the operator ADJUST_721_TIERS, SET_721_METADATA, MINT_721 and SET_721_DISCOUNT_PERCENT unless a prevent flag is set. `JB721TiersHook.setDiscountPercentOf` refuses an increase on a `cantIncreaseDiscountPercent` item, and removal refuses `cantBeRemoved`; both are refused before review.
- **Verification:** Unit tests for the reader, the three new dialog modes and the warning card; `npm run check` on the packed SDK; Codex until clean.
- **Resource budget:** One branch, one full gate, review passes as needed.
- **Authority and recovery:** Draft PR, merged on jango's word after SDK 6.8.0 is published. Three commits; each reverts alone.
- **Agent-system impact:** None.

### Review
- Full `npm run check` steps green on the packed SDK tarball: 3211 unit tests, 160 browser tests on port 3188. Budgets raised by under 1 KiB each on the revnet routes for the warning card, and all client JavaScript 2805 to 2810 on a measured 2809.8.
- Codex `gpt-6.1-sol` two passes: one finding fixed (a details edit dropped artwork whose digest is the media itself; the reader now keeps the reference), then CLEAN.
- The pay route tests run the SDK's order through `test/support/best-user-pay.ts`, since a mocked SDK entry cannot reach the call the real rule makes inside the package.
- Not rendered with a wallet: the three new dialog modes are covered by unit tests only.
- New copy for jango: the `COPY` table in `EditItemMediaModal.tsx` ("Edit details", "Set discount", "Remove item", their review and done lines), the removal warning, "Enter a discount from 0 to 100, in steps of 0.5.", "This item cannot be removed on {chain}."

## 2026-11-14: Round 9, jango's answers to the end list (V9)

- [x] V9a Pay review shows the paid chain's own notice; chains that read differently open on a toggle; a failed read gets one quiet line with Retry and never blocks the payment.
- [x] V9b Guides, option A: Learn says "owners", the Credits entries and claim-credits lines go; Build keeps "holder" and "reserved" only as contract names.
- [x] V9c Pay route: an estimated quote already reads "You get about" with an "At least" line (V6PayCard); nothing to add. A buyback pool's preview can overstate when the pool cannot fill the whole order at the previewed price: the rest is created at the revnet's rate, so delivery can be under the preview and never under the minimum.
- [x] V9d Earlier open questions, decided the way jango has been ruling: ERC-20 repay keeps its simulation; earlier copy stands. Review, 2026-11-14: Codex pass 1 moved the notice's Retry and versions toggle onto the pay form (the review covered them) and its two-projects-on-one-chain case was set aside (not possible for a revnet). Pass 2 corrected the Build guide: REVLoans needs BURN_TOKENS (11) from a borrower, as the borrow dialog already grants. Set aside from pass 2: a peer chain's notice edited while the page is open, and a failed re-read of the page's file after a good one. Full check green; 160 browser tests pass.

## Plan refinement
- **Objective:** Close the items jango answered on 2026-11-14 so revnet.money matches juicebox.money within revnet scope and states only what is true.
- **System fit:** `payNoticeView` in `src/lib/payNotice.ts` owns what a payer is shown; the pay card feeds it the page chain's full file and the indexer's per-chain notice. The same rule lives in juicebox.money's `pay-notice.ts`; it is small enough that an SDK release for it alone was not cut, and it moves there with the next one.
- **Reuse and simplicity:** One new registered indexer operation, one native `details` element, no new dependency.
- **Evidence and unknowns:** Each chain's project has its own metadata URI, and the indexer exposes `payDisclosure` per deployment. Not rendered with a wallet.
- **Verification:** Unit test for the rule; the pay card suites; the full check before the pull request; CI green before merge.
- **Resource budget:** One branch, one pull request.
- **Authority and recovery:** A pull request, merged on jango's word. One commit per item.
- **Agent-system impact:** None.

## 2026-11-14: Round 10, exact pay route choice and the shared notice rule (SDK 6.9.0)

- [x] S1 The pay card passes the connected account to the route choice (`simulateFrom`): each native-token route is run as that account and the one that delivers the most tokens wins.
- [x] S2 The payment notice rule comes from the SDK (`payNoticeView`); `src/lib/payNotice.ts` is removed. The site passes its chain order.
- [x] S3 `@bananapus/nana-sdk-core` pinned to 6.9.0 (published 2026-11-15).
- [x] S4 Gate on the packed SDK tarball (2026-11-14): every stage of `npm run check` passes, 3,216 unit and 160 browser tests. Four budgets raised by under 1 KiB each with the measured numbers beside them (terms 603, operator 685, extras 622, all client JavaScript 2812 KiB).

## Plan refinement
- **Objective:** A payer is sent to the route that delivers the most, decided on what each route actually does, and the notice rule has one home.
- **System fit:** The rule lives in the SDK; the pay card only passes the payer and the chain order.
- **Reuse and simplicity:** Two call-site changes and one deleted module.
- **Evidence and unknowns:** The SDK change is Codex-clean (four passes). An RPC without call overrides leaves the previews deciding, as before.
- **Verification:** The full check on the packed SDK tarball; CI after 6.9.0 is published.
- **Resource budget:** One draft pull request.
- **Authority and recovery:** Draft pull request; merged on jango's word after the SDK release. Reverts alone.
- **Agent-system impact:** None.

## 2026-11-15: A re-band's reviewed cap is enforced onchain

- [x] C1 A move (`prepareEditLiquidity`) and a market re-fit (`prepareMarketEdit`) end in `SETTLE` of each reviewed cap from the caller plus `TAKE_PAIR` (`cappedCloseActions`) in place of `CLOSE_CURRENCY` x2 [+ `SWEEP`]. Same bytes as juicebox.money and Juicescan.
- [x] C2 The editors require the wallet to hold the whole cap for such a plan.
- [x] C3 The review dialog shows the `SETTLE` step (SDK 6.10.0 decodes it).
- [x] C4 Pin `@bananapus/nana-sdk-core` 6.10.0 (published); full check green on the registry package.

## Plan refinement
- **Objective:** After signing, a price move can no longer make a re-band pull more from the wallet than the review's "Authorizes up to" figure (jango, 2026-11-15).
- **System fit:** The rule lives in the plan builders in `market/lib.ts`; panels gate the balance and display.
- **Reuse and simplicity:** One closing helper beside the existing one; the caps are the plan's `value` and `erc20Sides`.
- **Evidence and unknowns:** v4-periphery `_takePair` reads `_getFullCredit`, which reverts on a debt. Fork run on Base projects 3 and 6 through Juicescan's byte-identical builders: funded re-bands and re-fits execute, cut caps revert. A wallet holding less than the cap cannot send a re-band.
- **Verification:** Unit tests assert the exact actions, the settle parameters and the decoded steps; `npm run check` on the packed SDK tarball; CI after the pin.
- **Resource budget:** One pull request.
- **Authority and recovery:** jango asked for it in-session; merged on his word. Reverts alone.
- **Agent-system impact:** None.

## 2026-11-16: Liquidity balance gate needs the whole native value (G1)

- [x] G1 One rule, `liquidityShortfall`, for the position and market editors: a native pair must hold the whole value sent (headroom included), and an edit that pulls nothing reads no balance, so a failed read never blocks a withdrawal.

## Plan refinement

- **Objective:** Review refuses a native-pair increase the wallet cannot send, as Juicescan now does, instead of leaving the wallet to refuse it.
- **System fit:** The rule moves from four inline copies into one function beside the plan builders; both panels read it.
- **Reuse and simplicity:** No new reads, same wording, same error path.
- **Evidence and unknowns:** Codex reported the case on Juicescan's port of this gate (mejango/juicescan#131). Still as before: unclaimed fees and one-unit rounding are not modeled.
- **Verification:** Unit test of the rule, typecheck, full check.
- **Resource budget:** One small pull request per client.
- **Authority and recovery:** jango said yes to the port on 2026-11-16; pull requests, merge on his word.
- **Agent-system impact:** None.
