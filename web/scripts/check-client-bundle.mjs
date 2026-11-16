import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { appOrigin, deterministicEnvironment, fixtureOrigin } from "./lib/browser-environment.mjs";
import { vendorWallets } from "./lib/vendor-wallets.mjs";

// First-load JavaScript per route is what a visitor downloads before the page is
// interactive: every non-`nomodule` script the server-rendered HTML references, in its
// script tags and in the RSC payload the client hydrates from. Next's merged
// client-reference manifests can't stand in for it. Inside a route group they give a
// module two entries share the chunk list of whichever entry merged last, so a leak
// from one route into another (the 404 page pulling the home bundle into every
// project page, 29-86 KiB) read as no change at all. This check starts the built app
// against the deterministic fixture, fetches each route and gzips what its HTML
// references. Each ceiling is the route's measured size rounded up; lower it when a
// change makes the route smaller.
//
// `route` is the app route `path` renders. Every shipped page route must be listed.
const account = `0x${"1".repeat(40)}`;
// Project routes +4 KiB (2026-10-20): SDK 3.3.0 decodePayFailure revert table and the pay card's failure
// reason and retry (+2), then SDK 3.4.1's retry rule and router-converted quote minimums (+2).
// Routes +1-2 KiB (2026-10-22): Next 16.4.2's client runtime (critical advisories) adds 1.6-1.9 KiB to each;
// each ceiling is the new measurement rounded up.
// Most routes +1 KiB (2026-10-22): the loan dialogs read their token, decimals and currency onchain.
// /[slug], /[slug]/terms and /[slug]/owners +1 KiB (2026-10-22): SDK 4.0.0 (the failed swap quote's Retry line,
// the registry check before a queued movement's Execute) measures 569.1, 568.0 and 629.6 KiB.
// Next 16.4.2 (the image optimizer advisory GHSA-2464-fhr4-w9xw) adds 0.2-1.7 KiB to most routes;
// each changed ceiling is its new measure rounded up.
// SDK 4.0.0-local.7 (provenance-based error lines, the wallet-ready wait) adds 0.1-0.4 KiB to eight routes.
// Every write on core's useReviewedRun (revnet R3): the hook loads core's write hold and its lines
// with the page (the send engine stays lazy), +1-2 KiB on most routes, +10-13 KiB on /create and
// the project routes that write. Each changed ceiling is its new measure rounded up.
// SDK 4.0.0 (R5: core Relayr rounds, one plan review): +0.1-1.0 KiB on five routes; /extras +11.6,
// where webpack splits a shared 15.8 KiB chunk that repeats modules other chunks hold (all JS fell 16 KiB).
// 2026-10-24: shared shop authorization guards reject historical custom voting and deadlocked reserves
// before new signatures or funding. Measured routes are 550.8/579.2/577.8/585.4/595.2/424.3 KiB;
// round only those ceilings up. Discover/operator and the route-referenced ceiling remain fixed.
// Astra acquisition fix: callback invocation plus pre-invocation cleanup/UX measures551.4/578.4/586.0 KiB
// on create/terms/shop. Round only those ceilings up; all other route limits stay unchanged.
// 2026-10-26: source-token loan context and canonical reserve identity measure home393.0,
// project580.0, terms579.2 and extras596.1 KiB. Round only these route ceilings up;
// aggregate2759.9/2760 and referenced912.5/922 KiB remain within existing limits.
// SDK 5.0.0 (followed receipts, ended(), the follow option): shop 587.0 and project 581.0 KiB;
// round only those ceilings up. Its in-place follow and Relayr proof retry measure create 552.1,
// terms 580.2, extras 597.0 KiB and all client JS 2761.2 KiB; round only those up. The hold as the
// only outcome source measures operator 676.4 KiB; round only that ceiling up. Checked Safe
// completion and settlement provenance measure project 582.1, terms 581.0 and shop 588.1 KiB.
// One confirmed notice per settlement measures create 553.06 KiB; round only that ceiling up.
// 2026-10-28: URI-sensitive media keys and retryable detail reads affect shared chunks:
// CI measures extras 598.1 and holdings just above 414.0 KiB. Round only these ceilings up;
// aggregate 2761.6/2762 and route-referenced 915.3/922 KiB stay within existing limits.
// Read-status and recovery UX measures learn 354.1, audit 357.1 and account 425.1 KiB.
// Round only these ceilings up; aggregate 2761.7/2762 and referenced 915.3/922 remain within limits.
// CI measures operator just above 677 KiB; round that ceiling up without changing aggregate limits.
// Buyback 2.0.0 rollout (move preset, LP move, gateway history) measures project 584.9, terms 583.8,
// shop 591.1 and extras 600.7 KiB; round only those ceilings up.
// node-forge 1.4.3 (Para SDK security patch, lazy wallet chunk): all client JS measures 2764.9 KiB; round only that ceiling up.
// UX review fixes (skip link, search rows, shared token formatter, browser draft) measure / 395.1, learn 357.1,
// build 359.1, audit 360.1, discover 342.0, create 559.6, project 588.0, terms 587.2, shop 594.4, extras 604.4,
// account 428.2, holdings 417.4, projects 430.2, roles 391.5 KiB and all client JS 2773.1 KiB; round only those up.
// The not-found page now keeps the site nav and search, so it measures 355.7 KiB like other nav pages.
// SDK 6.0.0 (every buyback, router and gateway generation) measures / 396.0, learn 358.1, audit 361.0, create 560.1, account 429.1,
// holdings 418.3, projects 431.2, roles 392.4 and not-found 356.7 KiB; round only those up.
// Explicit pay, loan and payment-source state measures shop 595.1 KiB; round only that ceiling up.
// One Para sign-out generation measures build 360.2, route-referenced 922.2 and all client JS 2775.6 KiB; round only those up.
// One reviewed run vocabulary (SDK run status, held writes) and shared tab locks measure discover 343.3, create 562.2,
// project 590.0, terms 589.3, shop 596.8, extras 606.3, holdings 419.0, roles 393.2, not-found 357.4,
// route-referenced 924.3 and all client JS 2778.8 KiB; round only those up.
// Published SDK core 6.1.0 (replacing the packed tarball) measures project 590.2, shop 597.1 and all client JS 2779.2 KiB; round only those up.
// SDK core 6.2.0 with lock fencing, kept wallet answers and the shared hash field measures create 564.6, project 592.6,
// terms 591.9, shop 599.4, extras 608.9, account projects 432.6, route-referenced 927.0 (just over 927) and all client JS 2783.8 KiB;
// round only those up.
// SDK core 6.3.0 (lost-lock keeping, dismissal rules) measures create 567.4, project 595.4, terms 594.7,
// owners 633.2, shop 602.2, extras 611.7, account projects 434.1, route-referenced 929.8 and all client
// JS 2787.1 KiB; round only those up.
// SDK core 6.3.1 (a success left settled while away is shown, not adopted) measures route-referenced 930.04 KiB; round only that up.
// The homepage feeds page by row and end with a phone "More" cell: / measures 397.0 KiB (just over 397); round only that up.
// Guide code copy buttons: /learn measures 359.3 KiB and /build 361.1 KiB; round only those up.
const routes = [
  { route: "/", path: "/", kib: 398 },
  { route: "/learn", path: "/learn", kib: 360 },
  { route: "/build", path: "/build", kib: 362 },
  // The audit prompts render in the page so a fetch can read them: /audit measures 362.0 KiB (just over 362).
  { route: "/audit", path: "/audit", kib: 363 },
  // Telligence's own pages. Discover lists compute projects and the account's projects page offers
  // their compute controls, so they measure 355.3 and 463.4 KiB; /account/[id]/roles measures 396.3.
  // The Base fixture project measures operator 708.6 and owners 657.6 KiB.
  { route: "/discover", path: "/discover", kib: 356 },
  { route: "/how-it-works", path: "/how-it-works", kib: 348 },
  { route: "/recover", path: "/recover", kib: 461 },
  {
    route: "/compute/[projectId]",
    path: "/compute/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kib: 464,
  },
  {
    route: "/compute/[projectId]/keys",
    path: "/compute/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/keys",
    kib: 435,
  },
  // Permit2 pay authorization and the SDK's hook, router and revnet fee rules (SDK 6.6.0) measure /create 569.2,
  // /[slug] 599.8, terms 599.1, operator 682.4, owners 636.3, shop 605.9, extras 617.5, account 431.9 and
  // holdings 421.0 KiB: all client JavaScript grew 1.0 KiB, the rest is shared chunks regrouped. Rounded up only.
  // Items pin their media on choose and the shared .jb draft is read and written in place; the draft schema and
  // mapper load only when a file is used. /create measures 570.3 KiB.
  { route: "/create", path: "/create", kib: 571 },
  // Removing the credits UI regrouped shared chunks: all route JavaScript fell 3.7 KiB, while /[slug]
  // measures just over 596 KiB and /[slug]/extras 613.7 KiB. Round only those two up.
  // The cash out dialog reads its token from the chain's terminal (the SDK reader and the shared picker):
  // /[slug] measures just over 600.0 KiB. Rounded up only.
  // The unknown contracts warning sits in the revnet layout (its readers load on demand): every
  // revnet route measures under 1 KiB more (601.6, 600.8, 683.2, 639.8, 607.3, 620.1). Rounded up only.
  // The pay review's per-chain notice with its other-versions toggle and Retry line: measured 602.4, 601.6,
  // 640.5 and 608.0 KiB on /[slug], terms, owners and shop. Rounded up only.
  // SDK 6.9.0's pay route run as the payer (simulated payment, revert reading): terms measures just over
  // 602.0, operator 684.4 and extras 621.4 KiB. Rounded up only.
  { route: "/[slug]", path: "/base:1", kib: 603 },
  { route: "/[slug]/terms", path: "/base:1/terms", kib: 603 },
  { route: "/[slug]/operator", path: "/base:1/operator", kib: 709 },
  // Configured Safe service boundary with SDK 6.7.0 measures owners 637.7 and extras 618.3 KiB.
  // Round only these two incremental route costs up; static and aggregate ceilings stay unchanged.
  // Loans, bridge sends and claims in the shared activity rows, and the pay review's notice and beneficiary:
  // owners measures 638.4, shop 606.2, extras 619.1 and /account/[id] 432.2 KiB. Rounded up only.
  // The re-band net-debit check at send time together with SDK 6.9.0: owners measures 641.1 KiB. Rounded up only.
  { route: "/[slug]/owners", path: "/base:1/owners", kib: 658 },
  { route: "/[slug]/shop", path: "/base:1/shop", kib: 609 },
  { route: "/[slug]/extras", path: "/base:1/extras", kib: 622 },
  { route: "/account/[id]", path: `/account/${account}`, kib: 433 },
  { route: "/account/[id]/holdings", path: `/account/${account}/holdings`, kib: 422 },
  { route: "/account/[id]/projects", path: `/account/${account}/projects`, kib: 464 },
  { route: "/account/[id]/roles", path: `/account/${account}/roles`, kib: 397 },
  { route: "/_not-found", path: "/no-such-page/x/y", kib: 358, status: 404 },
];
// Next renders its global error page only when the root layout itself throws; no URL reaches it.
const unmeasuredRoutes = new Set(["/_global-error"]);
// A JSON list of the same shape replaces the routes above (the checker's own tests).
const checkedRoutes = process.env.CLIENT_BUNDLE_ROUTES
  ? JSON.parse(process.env.CLIENT_BUNDLE_ROUTES)
  : routes;
// 920 -> 922 (and all JS 2726 -> 2727): the onchain sucker-peer and group-write checks on top of Next 16.4.2.
// All JS 2727 -> 2730: the loan dialogs read their token, decimals and currency onchain.
// All JS 2730 -> 2754: the R stack on SDK 4.0.0 (core reviewed runs and Relayr rounds), measured 2752.4 locally and 2753.1 on CI.
// SDK 4.0.0 measures 921.2 KiB route-referenced (919.7 before); the ceiling moves up 1 KiB.
// Next 16.4.2 measures 923.0 KiB; the ceiling moves to 924.
// The forms pass (checkbox-gated options, inline export confirm, stacked phone tables) measures terms 595.2,
// extras 612.5, account 430.0 and route-referenced JS 932.4 KiB; round only those up.
// SDK 6.6.0 pay authorization and resolvers: measured 937.7 KiB route-referenced, rounded up only.
// The per-chain pay notice measures just over 939.0 KiB route-referenced, rounded up only.
const totalBudgetKiB = Number(process.env.CLIENT_TOTAL_GZIP_BUDGET_KIB ?? 940);
// Counts every emitted chunk, including ones a visitor may never download.
// WalletConnect (with @reown/appkit), Coinbase Wallet and Safe add ~690 KiB of
// strictly lazy vendor SDK here; the per-route budgets and the lazy-load
// assertions at the bottom of this file are what protect first paint.
// SDK 2.14.0's shared review measured 2599.8 KiB with one review per batch; a
// fee-return check for every fee-paying call in a batch review brings it to
// 2600.1 KiB, so the budget moved up by the minimum 1 KiB. Detecting a Safe by
// connector and WalletConnect peer measures 2600.9 KiB with the SDK's shared
// Safe maps replacing revnet's five copies, still within it. Formatting wallet
// balances as Juicebox Money does (rounded by decimal digits, dust kept visible)
// brings it to about 2601 KiB, so the budget moved up by the minimum 1 KiB again.
// axios 1.20.0 in Para's lazy chunk (+3.1), DOMPurify 3.4.16 (+0.4; 3.4.17 for GHSA-cg2g-xh64-v4q7 measures +0.4 more) and Next 16.3.8's
// client runtime (+0.2) measure 2604.7 KiB against 2601.1 KiB before, so the budget
// moves up by 4 KiB. The route budgets are unchanged.
// The transaction review moved into a provider plus a dialog loaded on the first
// request: every route's first load fell 7.5-27.3 KiB and route-referenced
// JavaScript 897.4 -> 883.0 KiB, but all client JavaScript measures 2610.7 KiB
// against 2605.2 KiB (SDK 2.17.0 alone changes nothing). The eager review held the
// select, wagmi config and other small shared modules in a chunk the layout and the
// pages shared; without it Next copies each into the page and lazy chunks that use
// it (the select alone is +10.0 KiB). The budget moves up by the minimum 5 KiB.
// SDK 2.17's Relayr quote binding (`bindRelayrQuote`, its bundle read and
// `relayrDestinationHash`) and its payment retry check (`requireRelayrPaymentRetry`,
// with its onchain payment proof) bring all client JavaScript to 2614.0 KiB against
// 2610.7 KiB, so the budget moves up by the minimum 4 KiB.
// SDK 2.18.0 puts each generated ABI in a module of its own. Webpack copies each one into
// every chunk that uses it, so all client JavaScript measures 2618.7-2618.8 KiB against
// 2614.0 KiB (largest route /[slug]/operator 655.1 -> 660.6 KiB). Builds vary by about
// 0.1 KiB, so the budget moves up 5 KiB to keep a clear margin.
// The send-safety fixes (the dialog hold through every send, the reviewed-account check,
// one output-less approve ABI, the SDK's sequence simulation in both Safe batch paths,
// the revert rule and the isolated reads of project-chosen tokens) measure 2623.9 KiB
// against 2618.8 KiB; the budget moves up to 2625 KiB.
// Deployment diagnostics keep contract reads on the server; their opt-in dialog,
// truthful data states and SDK deployment validation measure 2626.9 KiB against
// origin/main's 2623.3 KiB. The aggregate budget rises by the minimum 2 KiB;
// route and route-referenced budgets remain unchanged.
// Moving the shared diagnostics trigger into Extras adds 191 bytes for the
// section and button (2,689,893 -> 2,690,084 bytes gzip). The dialog stays in one chunk;
// only the aggregate ceiling moves up by the minimum 1 KiB.
// The SDK's Safe checks replace revnet's copies: authority identity with the Safe
// creation proof and its two pinned proxy creation codes, the strict Safe transaction
// and service readers, and the distribution receipt verifiers, which decode every
// log with the full controller, terminal and JBTokens ABIs. With the Safe badge's
// lazy import narrowed to the one export it uses, all client JavaScript measured
// 2640.1 KiB against 2626.8 KiB on main at a7609431, and the aggregate budget rises to
// 2641 KiB; route and route-referenced budgets remain unchanged.
// Binding each Safe proposal's result to the calls it was reviewed to run, its live
// approval count, the cached creation records and the unproven Ethereum handles line
// measure 2641.3 KiB against 2640.0 KiB; the aggregate budget rises by the minimum 1 KiB.
// Ending every Safe proposal the app can't follow (the watch's give-up rules and its read of a
// replaced nonce), the account's Dismiss and one bounded creation read for the page as well
// measure 2642.0 KiB against 2641.5 KiB, at the budget; it rises by the minimum 1 KiB.
// Following a Safe proposal to the chain's answer before it ends (its run of looks, the looks
// that learn nothing, a receipt's hour from its execution), the loan dialogs' unconfirmed line
// and the flows that stop reading such a proposal as pending measure 2643.0 KiB against
// 2641.9 KiB, at the budget; it rises by the minimum 1 KiB.
// Routes compiled only into the deterministic browser build (the IPFS and confirm
// proofs) never ship, so their own files are left out below. Measured that way,
// Juicebox Money's confirm primitives in every confirm bring all client JavaScript to
// 2640.6 KiB against origin/main's 2642.2 KiB at 00f0659e (largest route
// /[slug]/operator 675.4 -> 678.4 KiB), within the budget.
// Deciding Relayr sessions from the finalized chain through SDK 2.22.0's session rules (the
// classification, the outcome and its recheck, the reverted-quote release, the account view's
// check and Discard) measures 2644.2 KiB against 2641.7 KiB for origin/main's sources at dd5848ac
// on the same SDK; the aggregate budget rises by the minimum 1 KiB.
// SDK 2.23.0's reverted-quote rules (the release, the retry option, the payment attempt's outcome, the
// saved payment's proof and its strict reader) in place of revnet's copies measure 2645.0 KiB against
// 2644.2 KiB for origin/main's sources at 28a1393e on SDK 2.22.0; the aggregate budget rises by the
// minimum 1 KiB.
// One SDK Safe Relayr lifecycle replaces local preparation/funding/recovery decisions.
// With identical installed dependencies, HEAD 0f41a7d measures 2646.2 KiB and this
// migration 2650.9 KiB; the largest operator route decreases 691.0 -> 689.9 KiB.
// Raise only the aggregate ceiling to its measured integer KiB; route limits stay fixed.
// The build prompt adds progressive skill discovery, shared-token operating
// economics and transaction recovery guidance. On the same locked dependencies,
// HEAD 006935e2 measures 2650.9 KiB and the updated prompt 2651.5 KiB. Raise only
// the aggregate ceiling by the minimum 1 KiB; route limits stay unchanged.
// Safe recovery preserves lifecycle state and checks missing quotes against
// finalized Safe nonces. The final SDK/client build with strict journal guards
// and the updated build prompt measures 2657.1 KiB.
// Round up only the aggregate ceiling; route and wallet-loading limits stay fixed.
// Independent account/queue reads, shared Safe progress and liquidity price markers
// measure 2,725,587 B against HEAD 909cf1fd's 2,717,526 B (+8,061 B), using the same
// physical dependency graph and Node 26.5.0; only the SDK moves from 2.24.2 to 2.24.3.
// Round up only the aggregate ceiling; route and wallet-loading limits stay fixed.
// Shared cross-chain activity grouping and each original transaction link measure
// 2,726,333 B against HEAD 9d88fecc's 2,725,748 B (+585 B) on the same physical
// dependency graph. Round up only the aggregate ceiling; other limits stay fixed.
// Retained navigation with verified identity and bounded read/recovery behavior
// measures 2,733,461 B against clean 81aeb708's 2,726,293 B (+7,168 B, 0.26%) on
// identical physical dependencies. Duplicate server React imports and project
// contexts were removed before measuring. Round up only the aggregate ceiling;
// route-referenced JavaScript is 960,296 B versus 956,388 B; other limits stay fixed.
// Official SDK 2.24.5 plus the reviewed copy, permission and payment changes
// measure 2,734,565 B versus 2,730,720 B on the same physical dependency layout.
// Module copies and route references are unchanged; round only aggregate by 1 KiB.
// Shared SDK 2.25.0 boundaries, final wallet/recovery guards and sibling runtime
// alignment measure 2683.0 KiB in CI37724379135 at 92e58f79. Prior main CI37713095651
// measured 2670.4 KiB on Node 26.5; this candidate uses 26.7, wagmi 3.7.6 and viem
// 2.55.19, so this is a release-size comparison, not an exact causal allocation.
// Independent import review found no avoidable eager wallet or barrel load; all
// lazy checks pass. Round the measured aggregate to 2684 KiB; keep the 900 KiB
// route and 1100 KiB route-referenced ceilings and every lazy constraint unchanged.
// Cancellable routing quotes, phase messages and strict unsigned-publication
// recovery measure 2684.5 KiB versus c5ccbca6's 2683.4 KiB on the same locked
// Node 26.7.0 dependency tree. Raise only the aggregate ceiling by 1 KiB.
// Per-attempt routing progress measures 2685.2 KiB versus 29803a68's 2684.5 KiB
// with the same locked toolchain/dependencies. Keep route and lazy-load limits.
// Homepage Markee Rent adds verified reads, reviewed streams and durable recovery.
// Same-lock Node 26.7 builds measure 2686.3 KiB on HEAD 3ad4255a and 2700.9 KiB
// with Rent (+14.6 KiB), without new dependencies or eager wallet SDKs. Round
// only the aggregate ceiling to 2701 KiB; route and lazy-load limits stay fixed.
// SDK 2.31.0 makes the SDK the one home for write recovery (R119): its write journal
// with nonce proof, cross-tab locks with an IndexedDB fallback, the Safe proposal
// chain look, bridge destination-mint readiness and shared held/discard copy, plus
// the app's in-flow choice dialog. The same locked Node 26.7 tree measures 2716.1 KiB
// against 2700.9 KiB on main (+15.2 KiB, not split between SDK and app), with the
// largest route 709.6 KiB and route-referenced JavaScript 986.2 KiB, both in budget,
// and every lazy wallet check passing. Raise only the aggregate ceiling to 2717 KiB.
// Holding writes the browser can't store in the tab, no resend over a known pending hash,
// the confirmation that closes an open exit, and settling a proven Safe execution from its
// own transaction (the nonce search and execution-log read) measure 2717.4 KiB. Raise the
// aggregate ceiling to 2720 KiB for a small margin; route and lazy-load limits stay fixed.
// The SDK's write hold controller (its storage fallback, states and exit rules) replaces the
// app's copies and measures 2729.2 KiB, with the largest route at 718.0 KiB. Raise the
// aggregate ceiling to 2735 KiB; route and lazy-load limits stay fixed.
// SDK 2.35.0's intent keys and legacy-hold delegation, with Safe proposals, retried writes
// and Markee recovery under the write hold, measure 2736.3 KiB on the same locked Node 26.7
// tree. Raise only the aggregate ceiling to 2740 KiB; route and lazy-load limits stay fixed.
// SDK 2.38.0's shared intent builders, Safe batch identity, and the Safe follower handing every
// unproven end to the hold measure 2742.1 KiB, with the largest route at 728.5 KiB. Raise only
// the aggregate ceiling to 2746 KiB; route and lazy-load limits stay fixed.
// SDK 2.40.0's React held-write hooks (useSavedAttempt, useHeldWrite, useHeldWrites and
// HeldWritesNotice on the account page) replace the app's recovery and follower code and measure
// 2747.6 KiB. Raise only the aggregate ceiling to 2750 KiB; route and lazy-load limits stay fixed.
// The load-size pass (rendered-HTML gate, splitChunks, lazy dialogs and write machinery, SDK
// 3.1.0) measures 2714.9 KiB, route-referenced 912.1 KiB. Every ceiling drops to its measure.
// SDK 4.0.0 measures 2727.7 KiB (2726.1 before); the aggregate ceiling moves up 1 KiB.
// Next 16.4.2 measures 2729.5 KiB; the aggregate ceiling moves to 2730.
// The lazy review dialog renders SDK 4.0.0's review model (buildReviewModel and its decoders):
// 2733.2 KiB, routes unchanged; builds vary by 0.1 KiB. The aggregate ceiling moves to 2734.
// Every write on core's useReviewedRun measures 2766.6 KiB: core's hold and lines load with each
// writing page, and the app's own send engine is gone. The aggregate ceiling moves to 2767.
// The same artifact measures 2757.6 KiB total, +3.6 KiB (0.13%) over the previous ceiling.
// The same frozen acquisition-fix artifact measures2759.3 KiB, +1.7 KiB over the prior artifact.
// Explicit homepage availability and permission retry: measured 2760.4 KiB, rounded up only.
// Guide code copy buttons and the stages endpoint: measured 2789.3 KiB, rounded up only.
// SDK 6.6.0 pay authorization and resolvers: measured 2790.3 KiB, rounded up only.
// The market floor net of both fees (fee terminal and fee-free surplus reads) on published SDK
// 6.6.0: CI measured 2791.3 KiB, rounded up only.
// The shared .jb draft (SDK schema plus this site's mapper, in their own on-demand chunk): measured 2802.5 KiB,
// rounded up only.
// The ENS address field on the buyback and router card, view-as liquidity and the confirm fee rows:
// measured just over 2803.0 KiB, rounded up only.
// Loans, bridge sends and claims in activity and the pay review's notice: measured 2804.1 KiB, rounded up only.
// The shop item dialog's details, discount and removal modes, the unknown contracts warning and its
// on-demand audit chunk measure 2809.8 KiB all client JavaScript and 938.2 KiB route-referenced.
// The per-chain pay notice (versions toggle, Retry) measures 2810.7 KiB, rounded up only.
// SDK 6.9.0's pay route run as the payer measures 2811.2 KiB, rounded up only.
const allClientBudgetKiB = Number(process.env.CLIENT_ALL_JS_GZIP_BUDGET_KIB ?? 2812);
const totalBudget = totalBudgetKiB * 1024;
const allClientBudget = allClientBudgetKiB * 1024;
const buildDirectory = resolve(process.cwd(), ".next");
const appRoutesManifestPath = resolve(buildDirectory, "app-path-routes-manifest.json");

if (!existsSync(appRoutesManifestPath)) {
  throw new Error(`Missing ${appRoutesManifestPath}. Run \`npm run build:browser\` first.`);
}

const gzipSizes = new Map();

function javascriptAsset(asset) {
  // Next appends deployment IDs to chunk URLs. URL decorations are not part
  // of the emitted filename or its identity for budgets and lazy SDK checks.
  // Decode only after removing the suffix, so encoded filename characters
  // remain part of the path and are never treated as URL delimiters.
  const pathname = decodeURIComponent(asset.split(/[?#]/u, 1)[0]).replace(/^\/_next\//u, "");
  if (!pathname.endsWith(".js")) return null;
  const relativePath = relative(buildDirectory, resolve(buildDirectory, pathname));
  if (
    isAbsolute(pathname) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`A page references a client asset outside .next: ${asset}`);
  }
  return relativePath.split(sep).join("/");
}

function gzipSize(relativePath) {
  const cached = gzipSizes.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = resolve(buildDirectory, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`A page references a missing client asset: ${relativePath}`);
  }
  const size = gzipSync(readFileSync(absolutePath), { level: 9 }).byteLength;
  gzipSizes.set(relativePath, size);
  return size;
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

/**
 * The client chunks a page loads up front: every `static/chunks/*.js` its HTML names, in
 * script and preload tags or escaped inside the RSC payload, except in `nomodule` script tags,
 * which modern browsers skip. Imports a page starts after hydration are not counted here.
 */
function referencedChunks(html) {
  const unescaped = html
    .replace(/\\"/gu, '"')
    .replace(/\\u002F|\\\//gu, "/")
    .replace(/<script\b[^>]*\bnomodule\b[^>]*>/giu, "");
  return [
    ...new Set(
      [
        ...unescaped.matchAll(
          /(?:\/_next\/)?static\/chunks\/[^"'\s<>\\]+?\.js(?:[?#][^"'\s<>\\]*)?/gu,
        ),
      ]
        .map(([reference]) => javascriptAsset(reference))
        .filter(Boolean),
    ),
  ];
}

// Routes from `page.browsertest.tsx` compile only into the deterministic browser
// build (next.config.js) and never ship. Their own files, the chunks under
// static/chunks/app/<route>/, are left out of every budget. Any other chunk counts,
// even one only a proof route uses: a shipped route may load it on demand.
const appDirectory = resolve(process.cwd(), "src", "app");
const proofRoutes = new Set(
  filesBelow(appDirectory)
    .filter((file) => file.endsWith(`${sep}page.browsertest.tsx`))
    .map((file) => `/${relative(appDirectory, dirname(file)).split(sep).join("/")}`),
);
const appRoutes = JSON.parse(readFileSync(appRoutesManifestPath, "utf8"));
const shippedPageRoutes = Object.entries(appRoutes)
  .filter(([appPath]) => appPath.endsWith("/page"))
  .map(([, route]) => route)
  .filter((route) => !proofRoutes.has(route));

const failures = [];
const listed = new Set(checkedRoutes.map((entry) => entry.route));
for (const route of shippedPageRoutes.filter(
  (route) => !listed.has(route) && !unmeasuredRoutes.has(route),
)) {
  failures.push(`${route} is a shipped page with no rendered-HTML budget in this check`);
}

async function waitFor(url, child, label) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`${label} exited before it was ready (status ${child.exitCode})`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

// CLIENT_BUNDLE_ORIGIN measures an app that is already running (the checker's own tests).
const children = [];
let origin = process.env.CLIENT_BUNDLE_ORIGIN;
const measured = [];
try {
  if (!origin) {
    const environment = { ...process.env, ...deterministicEnvironment };
    const start = (args, label) => {
      const child = spawn(process.execPath, args, { env: environment, stdio: "ignore" });
      children.push(child);
      return child;
    };
    const fixture = start(["scripts/browser-fixture-server.mjs"], "Browser fixture");
    await waitFor(`${fixtureOrigin}/healthz`, fixture, "Browser fixture");
    const app = start(["node_modules/next/dist/bin/next", "start"], "App");
    await waitFor(`${appOrigin}/api/healthz`, app, "App");
    origin = appOrigin;
  }

  for (const entry of checkedRoutes) {
    const response = await fetch(new URL(entry.path, origin), {
      signal: AbortSignal.timeout(120_000),
    });
    const html = await response.text();
    const expected = entry.status ?? 200;
    if (response.status !== expected) {
      failures.push(`${entry.path} answered ${response.status}, expected ${expected}`);
      continue;
    }
    const assets = referencedChunks(html);
    if (assets.length === 0) {
      failures.push(`${entry.path} references no client JavaScript`);
      continue;
    }
    measured.push({
      ...entry,
      assets,
      size: assets.reduce((total, asset) => total + gzipSize(asset), 0),
    });
  }
} finally {
  for (const child of children) child.kill("SIGTERM");
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
for (const entry of measured) {
  console.log(
    `${kib(entry.size).padStart(10)} / ${String(entry.kib).padStart(4)} KiB  ${String(entry.assets.length).padStart(3)} chunks  ${entry.route} (${entry.path})`,
  );
  if (entry.size > entry.kib * 1024) {
    failures.push(`${entry.route} loads ${kib(entry.size)} (budget ${entry.kib} KiB)`);
  }
}

const routeAssets = new Set(measured.flatMap((entry) => entry.assets));
const totalSize = [...routeAssets].reduce((total, asset) => total + gzipSize(asset), 0);
const proofOnlyAsset = (asset) =>
  [...proofRoutes].some((route) => asset.startsWith(`static/chunks/app${route}/`)) &&
  !routeAssets.has(asset);
const allClientFiles = filesBelow(resolve(buildDirectory, "static", "chunks")).filter(
  (file) =>
    file.endsWith(".js") && !proofOnlyAsset(relative(buildDirectory, file).split(sep).join("/")),
);
if (allClientFiles.length === 0) {
  throw new Error("The production build contains no client JavaScript chunks.");
}
const allClientSize = allClientFiles.reduce(
  (total, file) => total + gzipSync(readFileSync(file), { level: 9 }).byteLength,
  0,
);

console.log(`Route-referenced JavaScript: ${kib(totalSize)} gzip`);
console.log(`All client JavaScript: ${kib(allClientSize)} gzip`);
console.log(
  `Budgets: per-route ceilings above, ${totalBudgetKiB} KiB route-referenced, ${allClientBudgetKiB} KiB all client JavaScript`,
);
if (totalSize > totalBudget) {
  failures.push(`route-referenced JavaScript is ${kib(totalSize)} (budget ${totalBudgetKiB} KiB)`);
}
if (allClientSize > allClientBudget) {
  failures.push(
    `all client JavaScript is ${kib(allClientSize)} (budget ${allClientBudgetKiB} KiB)`,
  );
}

for (const [label, markers] of vendorWallets) {
  const vendorAssets = allClientFiles
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return markers.some((marker) => source.includes(marker));
    })
    .map((file) => relative(buildDirectory, file).split(sep).join("/"));
  if (vendorAssets.length === 0) continue;
  const eager = vendorAssets.filter((asset) => routeAssets.has(asset));
  if (eager.length > 0) {
    failures.push(`${label} SDK is eagerly loaded: ${eager.join(", ")}`);
  } else {
    console.log(`${label} SDK is not in any route's HTML`);
  }
}

if (failures.length > 0) {
  console.error(`Client bundle budget exceeded:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
