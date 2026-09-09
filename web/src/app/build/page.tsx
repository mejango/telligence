import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build with revnets",
  description:
    "Launch a revnet without code, connect an app with the V6 SDK, or build Solidity integrations. Practical starting paths, transaction examples, and source references.",
  alternates: { canonical: "/build" },
  openGraph: {
    title: "Build with revnets",
    description:
      "Launch without code, connect an app with the V6 SDK, or build a Solidity integration. Choose a starting path and follow source-backed examples.",
    url: "/build",
    type: "website",
    images: [{ url: "/assets/img/revnet-social.png", width: 1428, height: 804, alt: "Revnet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Build with revnets",
    description:
      "Launch without code, connect an app with the V6 SDK, or build a Solidity integration. Choose a starting path and follow source-backed examples.",
    images: ["/assets/img/revnet-social.png"],
  },
};

const REFERENCE_ROOT = "https://github.com/mejango/revnet-money/blob/main";
const REV_CORE = "https://github.com/rev-net/revnet-core-v6/blob/main/src";
const NANA_CORE = "https://github.com/Bananapus/nana-core-v6/blob/main/src";
const SKILLS = "https://github.com/mejango/juicebox-skills/tree/main/plugins/juicebox-v6/skills";

const SECTIONS: readonly RevnetGuideSection[] = [
  // ------------------------------------------------------------------ Start here
  {
    id: "when-to-use-a-revnet",
    part: "Start here",
    title: "When to use a revnet",
    summary:
      "Use a revnet when committed token economics fit your product and contributors can be paid in tokens. Use a configurable Juicebox project when a team needs direct payouts or the ability to change its economic rules.",
    compare: {
      label: "Pick the model",
      columns: ["You need to", "Use"],
      rows: [
        ["Allocate a share of token issuance to contributors", "Revnet (split share)"],
        [
          "Give holders a configured way to cash out or borrow",
          "Revnet (subject to fees and available funds)",
        ],
        ["Run a token with a published schedule", "Revnet (stages)"],
        ["Pay out a budget to a team each month", "Juicebox project (payouts)"],
        ["Change the rules after launch", "Juicebox project (rulesets)"],
      ],
    },
    paragraphs: [
      "A revnet is a Juicebox V6 project whose owner contract, REVOwner, enforces the stage schedule committed at launch. The operator cannot rewrite that schedule, but can have powers over split recipients, routing, metadata, bridges, and shops. Read both the launch terms and the current integration state.",
      "This guide is written for three kinds of builder, and each section is tagged with who it is for. Project builders launch and run a revnet from this site without writing code. App builders connect a product to one with the SDK and the indexer. Contract builders extend one with Solidity. The parts overlap, so read the tags and skip what is not yours.",
    ],
    links: [
      { href: "/learn", label: "How a revnet works" },
      { href: "#launch-from-the-wizard", label: "Launch without writing code" },
      { href: "#set-up", label: "Connect an app with the SDK" },
      { href: "#extension-points", label: "Build a contract integration" },
      { href: "https://juicebox.money/build", label: "Juicebox build guide" },
    ],
  },
  {
    id: "operation-map",
    part: "Start here",
    title: "Every operation, in one table",
    summary:
      "Use this map to find the core call behind an action. Some flows need approvals, routing, or several transactions; the sections below explain the state, minimum outputs, and permissions to check.",
    table: {
      label: "User action → contract call",
      rows: [
        ["Launch a revnet", "REVDeployer.deployFor — buildDeployRevnetTx"],
        ["Pay / buy tokens", "JBMultiTerminal.pay — buildPayTx"],
        ["Buy a shop item", "JBMultiTerminal.pay with 721 metadata — build721PayMetadata"],
        ["Add funds, no tokens", "JBMultiTerminal.addToBalanceOf"],
        ["Cash out", "JBMultiTerminal.cashOutTokensOf — prepareHookAwareCashOut"],
        ["Claim credits as ERC-20", "JBController.claimTokensFor — buildClaimTokensTx"],
        ["Collect auto issuance", "REVOwner.autoIssueFor — buildAutoIssueTx"],
        ["Borrow", "REVLoans.borrowFrom — buildBorrowTx"],
        ["Repay", "REVLoans.repayLoan — buildRepayLoanTx"],
        [
          "Move a loan's collateral",
          "REVLoans.reallocateCollateralFromLoan — buildReallocateCollateralTx",
        ],
        ["Move tokens to another chain", "sucker.prepare → toRemote → claim"],
        ["Trade on the pool directly", "Uniswap V4 Universal Router — buildDirectPaySwapTx"],
        ["Add pool liquidity", "Uniswap V4 PositionManager.modifyLiquidities"],
        ["Operator: rename, redirect splits", "JBController.setUriOf / setSplitGroupsOf"],
        ["Operator: manage shop", "JB721TiersHook.adjustTiers / mintFor"],
        ["Operator: set up the pool", "JBBuybackHookRegistry.initializePoolFor / setHookFor"],
        ["Operator: add a chain", "REVDeployer.deploySuckersFor"],
        ["Operator: hand over", "REVOwner.setOperatorOf"],
      ],
    },
    paragraphs: [
      "Amounts are bigint in the token's own decimals until the display boundary. A revnet's identity is chain ID plus project ID; a sucker group links the chains but never makes their addresses, balances, or stage IDs interchangeable.",
    ],
  },
  {
    id: "the-pieces",
    part: "Start here",
    title: "The contracts, and where their addresses live",
    summary:
      "A revnet combines shared protocol contracts with project-specific tokens, shops, and bridge pairs. Start from the deployment artifacts, then resolve the project's active addresses on its chain.",
    table: {
      label: "Who does what",
      rows: [
        [
          "REVDeployer",
          "Writes the stage schedule and the sucker setup at launch; adds chains later",
        ],
        [
          "REVOwner",
          "Owns the project NFT, acts as its data hook, holds the operator's permissions, collects the revnet fee on cash outs",
        ],
        ["REVLoans", "Lends against revnet tokens; each loan is an NFT"],
        ["JBMultiTerminal", "Takes payments, holds the balance, executes cash outs"],
        [
          "JBController",
          "Issues tokens, distributes the split share, holds the ruleset (stage) data",
        ],
        [
          "JBBuybackHookRegistry + JBBuybackHook",
          "Routes a payment to the Uniswap V4 pool when that is better than issuing",
        ],
        ["JB721TiersHook", "The shop: tiers, prices, media"],
        ["JBSucker + JBSuckerRegistry", "Moves tokens and balance between chains"],
        [
          "JBRouterTerminalRegistry",
          "Accepts tokens the revnet does not hold directly and swaps them in",
        ],
      ],
    },
    points: [
      {
        key: "Addresses",
        text: "deploy-all-v6 publishes one artifact per contract per chain (address, ABI, source name) under deployments/<chain>/. Everything else derives from it: the SDK's jbContractAddress map and the skills library's chain-config.json.",
      },
      {
        key: "Chains",
        text: "Ethereum, Optimism, Base, Arbitrum, plus Sepolia and the three L2 Sepolias. The SDK's SUPPORTED_CHAINS and JB_CHAINS carry the list.",
      },
      {
        key: "Source",
        text: "the -v6 repos are current; older Juicebox versions are not interchangeable with them.",
      },
    ],
    links: [
      { href: "https://github.com/Bananapus/deploy-all-v6", label: "deploy-all-v6 (addresses)" },
      { href: "https://github.com/rev-net/revnet-core-v6", label: "revnet-core-v6" },
      { href: "https://github.com/Bananapus/nana-core-v6", label: "nana-core-v6" },
      { href: "https://github.com/Bananapus/version-6", label: "Every V6 repo" },
    ],
  },

  // ------------------------------------------------------------------ Project builders
  {
    id: "launch-from-the-wizard",
    part: "Project builders",
    audience: ["founders"],
    title: "Launch from the wizard",
    summary:
      "The create page walks through six sections. You can prepare and save a draft before connecting a wallet. Deployment needs a wallet on the selected chain and funds for the live creation fee and network costs. Review the committed stage terms before signing.",
    table: {
      label: "The six sections",
      rows: [
        [
          "1. Look",
          "Name (up to 50 characters), ticker (2–10), logo, an About in markdown, optional links. Pinned to IPFS as one metadata file at deploy time.",
        ],
        [
          "2. Settlement",
          "The reserve asset the revnet holds: ETH, USDC, both, or a custom ERC-20 checked on each chain. The base currency issuance is quoted in: ETH or USD. Which chains to run on.",
        ],
        [
          "3. Terms",
          "The complete stage schedule: issuance, cuts, split share, cash out tax, auto issuance, and timing. These economic commitments cannot be edited afterwards; authorized split recipients can still be redirected.",
        ],
        [
          "4. Store",
          "Optional items to sell, a pricing currency, and which store powers the operator keeps. A shop contract deploys even with zero items.",
        ],
        [
          "5. Operator",
          "Off by default, which assigns a dead address intended to be inaccessible. On: one address for all chains, or one per chain. Verify control of each address, especially a multisig on a new chain.",
        ],
        [
          "6. Deploy",
          "Get a fresh fee quote, review, then sign. One chain uses a wallet transaction or Safe proposal; multiple chains use a Relayr bundle paid from one chain. Confirm each destination separately.",
        ],
      ],
    },
    paragraphs: [
      "In Terms, each stage has an issuance rate (tokens per unit of base currency; a later stage can pick up where the previous one left off), an optional automatic cut (a percentage every N days, defaults 10% every 30 days), a cash out tax (a 0–80% slider in steps of 5, default 20%; the contracts allow anything below 100%), a split share with recipients (percent of every issuance, optionally different recipients per chain), and auto issuance rows (an amount, a beneficiary, and the chain where it can be claimed). By default the first start is set with a ten-minute buffer when the configuration is prepared; it is not ten minutes after eventual execution. You can set a later time. Subsequent stages start after the configured number of cuts or days.",
    ],
    note: "Stage starts must strictly increase, a split share above 0% needs at least one recipient, and the cut cadence should stay at a day or more. If a first-stage start is already in the past when the transaction lands, cash outs and loans lock for seven days. The wizard leaves that buffer for you.",
    links: [
      { href: "/create", label: "Open the wizard" },
      {
        href: `${REFERENCE_ROOT}/src/app/create/helpers/parseDeployData.ts`,
        label: "How the form becomes a deployFor call",
      },
    ],
  },
  {
    id: "draft-files",
    part: "Project builders",
    audience: ["founders"],
    title: "Draft files, and launching with an agent",
    summary:
      "Save the launch form as a .jb draft to reopen, share, or review before deployment. An AI agent can help prepare a draft; you still need to check the configuration and any transaction you sign.",
    paragraphs: [
      "A .jb file is JSON: the form's fields in the units you see on screen (days, percentages from 0 to 100, human token amounts). Import it at the top of the create page and every section fills in. Any live revnet's Extras tab exports one reconstructed from the chain, which is also the easiest way to diff what you launched against what you meant to.",
      "An agent has two ways to launch. It can produce a .jb for you to import, check, and sign, which keeps the keys with you. Or it can call REVDeployer.deployFor itself through the SDK's buildDeployRevnetTx, which is the path for automated or scripted launches.",
    ],
    points: [
      {
        key: "Limits",
        text: "up to 32 stages, 16 chains, 64 store items, 2 MB. Media cannot travel inside JSON; item images arrive as already-pinned ipfs:// URIs.",
      },
      {
        key: "Skills",
        text: "jb-deploy-ui for launch interfaces, revnet-economics and revnet-modeler for exploring configurations. Check generated drafts against the current schema and live deployment contracts.",
      },
    ],
    links: [
      { href: `${REFERENCE_ROOT}/src/lib/revnet-draft.ts`, label: "Draft format" },
      { href: `${REFERENCE_ROOT}/src/app/create/types.ts`, label: "Every field" },
      { href: `${SKILLS}/jb-deploy-ui/SKILL.md`, label: "Launch interface skill" },
    ],
  },
  {
    id: "what-deploy-does",
    part: "Project builders",
    audience: ["founders", "frontend"],
    title: "What happens when you deploy",
    summary:
      "The wizard prepares a deployFor call for each selected chain using matching configuration and salts. Check every destination result: chain-local project IDs and completion states are separate, even when the token address matches.",
    points: [
      {
        key: "Creation fee",
        text: "read JBProjects.creationFee() on each chain immediately before preparing the deployment. The fee recipient and its route determine any fee-project tokens received; show the quoted fee separately from gas and relay costs.",
      },
      {
        key: "Token",
        text: "an ERC-20 named after your revnet with your ticker. Matching deployments can share a token address across chains when the deployer, sender, configuration hash, and salts match; verify the resulting address on each chain.",
      },
      {
        key: "Pool",
        text: "a Uniswap V4 pool per accepted token is initialized at the issuance price with a 1% fee tier, 200 tick spacing, and a two-day TWAP window. It starts empty; liquidity is added later.",
      },
      {
        key: "Chains",
        text: "with two or more chains, Relayr submits a paid bundle. Completion depends on each chain and the relay service; do not promise a fixed settlement time. With one chain, use a wallet transaction or Safe proposal and wait for execution.",
      },
      {
        key: "Afterwards",
        text: "each chain has its own project ID; the page lives at /<chain>:<id>. The Terms tab shows the schedule as the contracts hold it.",
      },
    ],
    note: "Safe owners: a proposal that executes after the first stage's start has passed triggers the seven-day cash out and loan lock. Leave the buffer, or set a later start.",
  },
  {
    id: "running-a-revnet",
    part: "Project builders",
    audience: ["founders"],
    title: "Running it: what the operator can do",
    summary:
      "The operator has nine default permissions plus any integration permissions granted at launch. The Operator tab exposes available actions; inspect grants per chain because routing, recipients, and shop decisions can affect users.",
    table: {
      label: "Operator tab",
      rows: [
        [
          "Edits",
          "Name, description, logo, links; an ENS handle; the recipients of the current stage's split share (never its size)",
        ],
        [
          "Chains",
          "Extend the revnet to a new chain with the same configuration, if the stage's metadata allows it (the wizard always allows it)",
        ],
        [
          "Buyback router",
          "Point at a buyback hook, pick a router terminal, set the TWAP window (5 minutes to just under 2 days), or initialize a pool by hand if the automatic one was front-run",
        ],
        [
          "Shop",
          "Add items (media pinned to IPFS), mint up to 50 free copies of an item. Removal and discount edits are contract-level powers this site does not yet expose",
        ],
        ["Account", "Hand the role to another address, or to the zero address to end it"],
        [
          "Permissions",
          "A read-only view of what is granted, flagging grants that no longer authorize anything",
        ],
      ],
    },
    paragraphs: [
      "Liquidity lives under Owners → Market. Anyone can add liquidity to the pool through Uniswap V4's position manager, single-sided if you like; the site shows the pool's composition, depth by price band, and every position.",
      "Cannot: change issuance, cuts, cash out taxes, split percentages, stage timing, or withdraw the balance. There is no owner key. The project NFT is held by REVOwner, which will never transfer it.",
    ],
    links: [
      {
        href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/operator/V6OperatorTab.tsx`,
        label: "Operator tab source",
      },
      { href: `${REV_CORE}/REVOwner.sol`, label: "REVOwner.sol" },
    ],
  },
  {
    id: "money-in-and-out",
    part: "Project builders",
    audience: ["founders"],
    title: "Money in, money out, and the fees",
    summary:
      "Accept payments in supported assets or through available swap and on-ramp routes. Contributors receive tokens; there is no discretionary team payout budget. Market, shop, fee, loan, and bridge flows can route funds outside the local balance.",
    paragraphs: [
      "Your team is paid in tokens: the split share of every issuance, plus any auto issuance the stage names. Recipients collect auto issuance from the Owners tab. Holders get a You card with cash out, borrow, move between chains, and claim credits. Card and bank payments go through the embedded wallet's on-ramp, which buys the accepted token first.",
    ],
    table: {
      label: "Fees to expect",
      rows: [
        [
          "Launch",
          "Read JBProjects.creationFee() on every selected chain, then add network or relay costs",
        ],
        [
          "Payments",
          "No standard protocol fee for an incoming payment. Swaps, bridges, card providers, and configured shop splits can add costs or route funds; show the actual breakdown",
        ],
        [
          "Cash outs (tax above 0%)",
          "Standard treasury path: 2.5% protocol fee on reclaimed value, plus a Revnet fee valued from 2.5% of the token count. Different bases; quote net output through the hook. Pool paths and exemptions can differ",
        ],
        [
          "Cash outs (0% tax)",
          "No standard Revnet fee. A protocol fee can apply to the portion backed by previously fee-free intra-terminal payouts; read the terminal preview",
        ],
        [
          "Loans",
          "Standard new loan: 2.5% protocol fee, a 1% REV fee when available, and a prepaid source fee of 2.5–50% retained by the lending revnet. Show gross principal, net proceeds, repayment cost, and the 3,650-day expiry",
        ],
        ["Cross-chain moves", "Bridge gas, quoted at the time of the move"],
      ],
    },
  },
  {
    id: "choosing-the-numbers",
    part: "Project builders",
    audience: ["founders"],
    title: "Choosing the numbers",
    summary:
      "Model the complete schedule before launch. There is no universal safe tax, cut cadence, or allocation: compare outcomes under realistic revenue, holder concentration, and withdrawal scenarios.",
    points: [
      {
        key: "Issuance and cuts",
        text: "simulate both low and high revenue as issuance falls. Show tokens reaching the payer after the split, and consider every stage transition. A shorter cadence makes timing more important; the contract documentation recommends at least a day.",
      },
      {
        key: "Cash out tax",
        text: "compare exits at several shares of total supply. A higher tax retains more of a proportional withdrawal. Loans also use the current cash out tax, so borrowing is not a shortcut around it; compare net proceeds and repayment obligations.",
      },
      {
        key: "Split share",
        text: "stepping down across stages (30% → 20% → 10%) pays early contributors more without a governance vote later.",
      },
      {
        key: "Stages",
        text: "align starts with actual product needs and model late payments around transitions. The final stage continues, including any recurring issuance cuts. Zero issuance prevents further minting from payments, but does not cancel other token allocations.",
      },
      {
        key: "Concentration",
        text: "test large-holder exits, auto issuance claims, heavy borrowing, and empty local balances. Outstanding loans affect both effective supply and backing; arbitrary concentration thresholds do not establish safety.",
      },
    ],
    links: [
      { href: `${SKILLS}/revnet-economics/SKILL.md`, label: "revnet-economics skill" },
      { href: `${SKILLS}/revnet-modeler/SKILL.md`, label: "revnet-modeler skill" },
      { href: "https://github.com/mejango/rev-sim", label: "rev-sim (simulator)" },
    ],
  },

  // ------------------------------------------------------------------ App builders
  {
    id: "set-up",
    part: "App builders",
    audience: ["frontend"],
    title: "Set up the SDK",
    summary:
      "@bananapus/nana-sdk-core carries the ABIs, the addresses, the reads, and a pure builder for every write. Do not hand-maintain selectors or addresses in product code.",
    paragraphs: [
      "The root entry exports every ABI, jbContractAddress, the chain list, the bendystraw helpers, and project-metadata reads. The /v6 entry exports the reads and builders. Builders are pure: validated input in, a { chainId, address, abi, functionName, args, value } request out. Keep reads on a public client for the target chain and writes on a wallet client connected to that same chain.",
      "Start with a TypeScript app and a viem public client for the selected chain; add a wallet client only for signing. Install @bananapus/nana-sdk-core and viem, and pin versions in your lockfile. The examples are focused integration fragments: provide the named clients, chain ID, addresses, user inputs, and error handling in your app.",
    ],
    table: {
      label: "/v6 exports, grouped",
      rows: [
        [
          "Reads",
          "getAccountingContexts, resolvePaymentTerminal, getCurrentRuleset, getUpcomingRuleset, getAllRulesets, previewPay, chooseBestPayRoute, getCashOutQuote, getHookAwareCashOutQuote, getBorrowableAmount, getV6SuckerPairs, getSuckerMovements, getTokenAddress, getCreditBalance, getProjectCreationFee, getProject721Shop, hasPermissions, getCashOutDelay, isRevnetOperator",
        ],
        [
          "Builders",
          "buildPayTx, buildCashOutTx, buildDeployRevnetTx, buildAutoIssueTx, buildBorrowTx, buildRepayLoanTx, buildReallocateCollateralTx, buildClaimTokensTx, buildTransferCreditsTx, buildBurnTokensTx, buildSetSplitGroupsTx, buildSetPermissionsTx, buildBridgePrepareTx, buildToRemoteTx, buildBridgeClaimTx, buildSyncAccountingDataTx, buildDirectPaySwapTx, buildPermit2ApproveTx, buildCollectUniswapV4FeesTx",
        ],
        ["Prepare helpers", "prepareHookAwareCashOut, prepareBestCashOut, claimFromSuckerMovement"],
        [
          "Config builders",
          "buildRevnetStageConfig, buildAccountingContext, buildSplit, fillSplitPercents, build721RulesetMetadata, build721PayMetadata, buildBuybackCashOutMetadata",
        ],
        [
          "Constants",
          "slippageFloor, REV_METADATA_ALLOW_SUCKER_DEPLOYMENT, RULESET_WEIGHT_INHERIT, STANDARD_FEE, MAX_FEE, RESERVED_TOKEN_SPLIT_GROUP_ID, PERMIT2_ADDRESS, the uniswapV4* math family",
        ],
        [
          "Sub-entries",
          "/v6/loans, /v6/loan-math, /v6/cash-out, /v6/permit2, /v6/direct-pay, /v6/uniswap-v4, /chains, /jbcenter",
        ],
      ],
    },
    codePoints: [
      {
        title: "Imports and address lookup",
        details: [
          {
            key: "Package",
            value: "@bananapus/nana-sdk-core (root) and @bananapus/nana-sdk-core/v6",
          },
          { key: "Identity", value: "{ chainId: JBChainId, projectId: bigint }" },
          {
            key: "Address",
            value:
              'jbContractAddress["6"][JBCoreContracts.JBMultiTerminal][chainId], or getJBContractAddress(contract, 6, chainId)',
          },
        ],
        code: [
          "import {",
          "  buildBorrowTx, buildBridgeClaimTx, buildBridgePrepareTx, buildCashOutTx,",
          "  buildClaimTokensTx, buildDeployRevnetTx, buildPayTx, buildRepayLoanTx,",
          "  buildRevnetStageConfig, buildToRemoteTx, getBorrowableAmount,",
          "  prepareHookAwareCashOut, previewPay, REV_METADATA_ALLOW_SUCKER_DEPLOYMENT,",
          "  slippageFloor,",
          '} from "@bananapus/nana-sdk-core/v6";',
          "",
          "import {",
          "  getJBContractAddress, JBCoreContracts, RevnetCoreContracts,",
          "  jbMultiTerminalAbi, revLoansAbi, type JBChainId,",
          '} from "@bananapus/nana-sdk-core";',
          "",
          "const terminal = getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId);",
          "const loans = getJBContractAddress(RevnetCoreContracts.REVLoans, 6, chainId);",
        ].join("\n"),
        links: [
          {
            href: "https://www.npmjs.com/package/@bananapus/nana-sdk-core",
            label: "V6 SDK package",
          },
          { href: "https://github.com/Bananapus/juice-sdk-v4", label: "SDK source" },
          { href: `${SKILLS}/jb-v6-api/SKILL.md`, label: "V6 API skill" },
        ],
      },
    ],
  },
  {
    id: "read-the-revnet",
    part: "App builders",
    audience: ["frontend"],
    title: "Read the revnet",
    summary:
      "Use the index (next section) to find and display revnets. Use the chain for anything a signature depends on, and read it again right before signing.",
    table: {
      label: "What to read, and where",
      rows: [
        ["Controller, terminals", "JBDirectory.controllerOf / terminalsOf / primaryTerminalOf"],
        ["Current and next stage", "JBController.currentRulesetOf / upcomingRulesetOf"],
        ["Full schedule", "JBController.allRulesetsOf(projectId, startingId, size)"],
        ["Accepted tokens", "JBMultiTerminal.accountingContextsOf"],
        [
          "Supply and balances",
          "JBTokens.totalBalanceOf / creditBalanceOf; JBController.totalTokenSupplyWithReservedTokensOf; REVLoans.totalCollateralOf / totalBorrowedFrom for effective loan accounting",
        ],
        ["Splits", "JBSplits.splitsOf(projectId, rulesetId, groupId)"],
        ["Cash out quote", "JBMultiTerminal.previewCashOutFrom"],
        ["Loan capacity", "REVLoans.borrowableAmountFrom / loanOf"],
        ["Chains", "JBSuckerRegistry.suckerPairsOf"],
        [
          "Operator",
          "A JBPermissions grant scoped to (REVOwner, revnetId): JBPermissions.hasPermissions, or the SDK's isRevnetOperator",
        ],
      ],
    },
    codePoints: [
      {
        title: "Resolve the live controller, then read the stage",
        code: [
          "import {",
          "  getJBContractAddress, JBCoreContracts, jbDirectoryAbi, jbControllerAbi,",
          '} from "@bananapus/nana-sdk-core";',
          "",
          "const directory = getJBContractAddress(JBCoreContracts.JBDirectory, 6, chainId);",
          "const controller = await publicClient.readContract({",
          "  address: directory, abi: jbDirectoryAbi,",
          '  functionName: "controllerOf", args: [projectId],',
          "});",
          "const stage = await publicClient.readContract({",
          "  address: controller, abi: jbControllerAbi,",
          '  functionName: "currentRulesetOf", args: [projectId],',
          "});",
          "",
          "// Resolve the accepted terminal for your payment token separately.",
          "// Re-read all quote dependencies immediately before simulateContract.",
        ].join("\n"),
        links: [
          { href: `${REFERENCE_ROOT}/src/lib/nana/project.tsx`, label: "Reference project reads" },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/terms/getRulesets.ts`,
            label: "Stage reads",
          },
        ],
      },
    ],
    note: "Show cached names, logos, and facts while the chain refreshes. Treat state you could not read as unknown, never as zero, empty, or permitted.",
  },
  {
    id: "indexed-data",
    part: "App builders",
    audience: ["frontend"],
    title: "Indexed data: Bendystraw",
    summary:
      "Bendystraw indexes on-chain events into searchable data for discovery, activity, charts, holders, and liquidity positions. Use it to display history; use fresh contract reads to authorize a transaction.",
    paragraphs: [
      "A Ponder service watches supported contracts and serves indexed results over GraphQL, an API where you request named fields. The index can lag, return incomplete history, or be unavailable. Distinguish loading, unavailable, stale, and empty results; a missing row is not proof that a revnet or transaction does not exist.",
      "This site never sends GraphQL text from the browser. Each query is registered on the server under an operation id; the browser posts { operation, variables } to a same-origin route that validates the variables and forwards it. Heavier history and ranking queries are server-only. Copy that shape if you expose the index to untrusted clients.",
    ],
    table: {
      label: "Endpoints",
      rows: [
        [
          "Mainnets",
          "https://bendystraw.up.railway.app/graphql — Ethereum, Optimism, Base, Arbitrum; no API key",
        ],
        ["Testnets", "https://testnet.bendystraw.xyz/graphql — Sepolia and the L2 Sepolias"],
        ["Schema", "…/schema opens a playground; POST an introspection query for codegen"],
      ],
    },
    codePoints: [
      {
        title: "What a revnet page asks for",
        details: [
          {
            key: "The revnet",
            value: "project(chainId, projectId, version: 6) → name, balance, owner, suckerGroupId",
          },
          { key: "Its chains", value: "projects(where: { suckerGroupId })" },
          {
            key: "Activity",
            value: "activityEvents / payEvents / cashOutTokensEvents by projectId or suckerGroupId",
          },
          { key: "Holders", value: "participants" },
          {
            key: "Market",
            value: "buybackPools → swapEvents (post-trade sqrtPriceX96) → buybackPoolPositions",
          },
          { key: "Loans", value: "loans, borrowLoanEvents" },
          { key: "Cross-chain", value: "suckerTransactions and their status" },
        ],
        code: [
          'import { requestBendystraw, selectBendystrawEndpoint } from "@bananapus/nana-sdk-core";',
          "",
          "const endpoint = selectBendystrawEndpoint(",
          '  { mainnet: "https://bendystraw.up.railway.app/graphql", testnet: "https://testnet.bendystraw.xyz/graphql" },',
          "  { chainId },",
          ");",
          "",
          "type RevnetResult = {",
          "  project: { name: string | null; balance: string; owner: string; suckerGroupId: string | null } | null;",
          "};",
          "type RevnetVariables = { chainId: number; projectId: number };",
          'if (projectId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Project ID exceeds the indexer numeric range");',
          "",
          "const { project } = await requestBendystraw<RevnetResult, RevnetVariables>(",
          "  endpoint,",
          "  `query Revnet($chainId: Float!, $projectId: Float!) {",
          "     project(chainId: $chainId, projectId: $projectId, version: 6) {",
          "       name balance owner suckerGroupId",
          "     }",
          "   }`,",
          "  { chainId, projectId: Number(projectId) },",
          ");",
          "// Treat project === null as not indexed; do not turn its balances into zero.",
          "// Generate response types from the current endpoint schema in production.",
        ].join("\n"),
        links: [
          { href: "https://github.com/peripheralist/bendystraw", label: "Bendystraw source" },
          { href: "https://bendystraw.up.railway.app/schema", label: "Playground" },
          {
            href: `${REFERENCE_ROOT}/src/lib/bendystraw/operations.ts`,
            label: "This site's queries",
          },
          {
            href: `${REFERENCE_ROOT}/src/app/api/bendystraw/%5Bnet%5D/query/route.ts`,
            label: "The same-origin route",
          },
        ],
      },
    ],
    points: [
      {
        key: "Key by chain",
        text: "chainId + projectId, never projectId alone — the same number exists on every chain. Filter V6 rows with version: 6.",
      },
      {
        key: "Float, not Int",
        text: "numeric arguments on singular queries are Float! (Ponder's choice); an Int! variable fails validation with no data.",
      },
      {
        key: "Page to the end",
        text: "lists take limit and offset and return totalCount; loop rather than trusting one page.",
      },
      {
        key: "suckerGroupId is as-of-event",
        text: "rows written before chains were linked keep the old group id; query every project in the group for full history.",
      },
      {
        key: "Pool reserves without RPC",
        text: "sum the indexed positions at the latest swap's sqrtPriceX96 — the recipe is in the jb-bendystraw skill and this site's price chart.",
      },
    ],
    note: "Building with an agent? The jb-bendystraw skill carries the schema, these query patterns, and the gotchas. Hand it over before asking for a feed, chart, or holder table.",
  },
  {
    id: "accept-payments",
    part: "App builders",
    audience: ["frontend"],
    title: "Get paid",
    summary:
      "Quote the terminal, compare any live market route, then sign with a minimum token output. Tell the user which route they are taking.",
    paragraphs: [
      "A terminal payment issues new tokens or, if the buyback hook finds a better price, buys from the pool. A direct pool swap is a different transaction that skips the split share. Compare executable, slippage-protected minimums rather than chart prices.",
      "ERC-20 payments approve only the request's spender for only the required amount (this site uses a plain approve for pay and repay; Permit2 is reserved for direct pool swaps). Native payments carry the amount in value. Shop purchases are payments with tier metadata; show every NFT plus the token result in the confirmation.",
    ],
    codePoints: [
      {
        title: "JBMultiTerminal.pay",
        details: [
          { key: "Quote", value: "previewPay → previewPayFor" },
          { key: "Builder", value: "buildPayTx" },
          { key: "Bound", value: "minReturnedTokens" },
          { key: "Shop metadata", value: "build721PayMetadata" },
          {
            key: "Not directly accepted?",
            value: "resolvePaymentTerminal finds the router terminal; chooseBestPayRoute compares",
          },
        ],
        code: [
          "const quote = await previewPay(publicClient, {",
          "  chainId, terminal, projectId, token, amount, beneficiary, metadata,",
          "});",
          'if (quote.beneficiaryTokenCount <= 0n) throw new Error("No token output; review the payment terms");',
          "",
          "const tx = buildPayTx({",
          "  chainId, terminal, projectId, token, amount, beneficiary, metadata,",
          "  minReturnedTokens: slippageFloor(quote.beneficiaryTokenCount, 100n), // 1% tolerance; 100 basis points",
          "  memo,",
          "});",
          "",
          "// ERC-20: approve tx.address. Native: tx.value === amount.",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/pay/V6PayCard.tsx`,
            label: "Payment route and approval flow",
          },
          { href: `${REFERENCE_ROOT}/src/lib/v6/pay.ts`, label: "Route preview helpers" },
        ],
      },
      {
        title: "JBMultiTerminal.addToBalanceOf",
        description:
          "Adds funds without issuing tokens. Only for a token the terminal accepts directly.",
      },
    ],
  },
  {
    id: "cash-out",
    part: "App builders",
    audience: ["frontend"],
    title: "Cash out",
    summary:
      "Quote through the terminal's hook-aware preview. A surplus-only calculation can disagree with the transaction that actually runs.",
    paragraphs: [
      "previewCashOutFrom runs the real data hook and buyback decision. The route decides where the minimum goes: minTokensReclaimed on the treasury path, buyback metadata on the pool path. Re-quote after any stage, supply, balance, pool, or fee change.",
      "Credits and claimed ERC-20 tokens behave differently on the open market. Only compare a direct swap for the claimed balance the router can actually spend.",
    ],
    codePoints: [
      {
        title: "JBMultiTerminal.cashOutTokensOf",
        details: [
          {
            key: "Prepare",
            value: "prepareHookAwareCashOut → previewCashOutFrom + buildCashOutTx",
          },
          { key: "Treasury bound", value: "route.terminalMinimum" },
          { key: "Pool bound", value: "route.metadata" },
          { key: "Token count", value: "18-decimal bigint" },
        ],
        code: [
          "const prepared = await prepareHookAwareCashOut(publicClient, {",
          "  chainId, terminal, holder, projectId, cashOutCount, tokenToReclaim,",
          "  beneficiary,",
          "});",
          "",
          "const { route, transaction: tx } = prepared;",
          "// Pool routes are re-previewed with their slippage metadata before return.",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/RedeemDialog.tsx`,
            label: "Cash out implementation",
          },
          { href: `${REFERENCE_ROOT}/src/hooks/useCashOutRoute.ts`, label: "Hook-aware quote" },
        ],
      },
      {
        title: "Token-account operations",
        details: [
          { key: "Claim credits", value: "buildClaimTokensTx → JBController.claimTokensFor" },
          { key: "Burn", value: "buildBurnTokensTx → JBController.burnTokensOf" },
          { key: "Auto issue", value: "buildAutoIssueTx → REVOwner.autoIssueFor" },
        ],
      },
    ],
    note: "Use the hook-aware net quote rather than subtracting a flat 5%. The standard taxed treasury path applies a 2.5% protocol fee to value and values the Revnet fee from 2.5% of the token count. At 0% tax, previously fee-free intra-terminal payouts can still make part of the cash out protocol-fee-bearing. The registered sucker's bridge cash out is untaxed and bypasses the launch lock; the receiving holder's later cash out does not inherit that exemption.",
  },
  {
    id: "operate-loans",
    part: "App builders",
    audience: ["frontend"],
    title: "Loans",
    summary:
      "Derive loan bounds from live collateral capacity, fees, source token, and permissions, never from a cached cash out estimate.",
    paragraphs: [
      "Before borrowing, read borrowableAmountFrom in the chosen accounting context. borrowableNow caps gross principal by live funds; borrowableCapacity is the economic collateral capacity and may be larger. minBorrowAmount protects gross principal before fees, not net proceeds. Show the expected net amount after protocol, REV, and prepaid source fees separately.",
      "A holder acting for themselves needs no permission grant; a contract or operator borrowing on a holder's behalf needs OPEN_LOAN (37) from that holder. Collateral and source token are chain-local. Loan permissions can redirect funds or recovered collateral, so explain the specific authority before requesting a grant.",
      "Before repaying, re-read loanOf and the source fee, compute a conservative ceiling, approve or permit the source token if needed, and simulate the exact collateral being returned. Native repayment sends the ceiling as value; the excess is refunded.",
    ],
    codePoints: [
      {
        title: "REVLoans.borrowFrom",
        details: [
          { key: "Quote", value: "getBorrowableAmount / borrowableAmountFrom" },
          { key: "Builder", value: "buildBorrowTx" },
          {
            key: "Permission",
            value: "OPEN_LOAN = 37 (REPAY_LOAN = 39, REALLOCATE_LOAN = 38 for the other calls)",
          },
          {
            key: "Bound",
            value: "minBorrowAmount protects gross principal; calculate net proceeds separately",
          },
        ],
        code: [
          "const { borrowableNow } = await getBorrowableAmount(publicClient, {",
          "  chainId, revnetId, collateralCount, decimals, currency,",
          "});",
          'if (borrowableNow <= 0n) throw new Error("No funds available to borrow for this collateral");',
          "",
          "const tx = buildBorrowTx({",
          "  chainId, revnetId, token, collateralCount, beneficiary, holder,",
          "  prepaidFeePercent,            // 25–500 (2.5%–50%, out of 1000)",
          "  minBorrowAmount: slippageFloor(borrowableNow, 100n), // gross principal, 1% tolerance",
          "});",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/lib/loanTransactions.ts`,
            label: "Protected loan builders",
          },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/hooks/useBorrowDialog.tsx`,
            label: "Borrow operation",
          },
        ],
      },
      {
        title: "REVLoans.repayLoan",
        details: [
          { key: "Builder", value: "buildRepayLoanTx" },
          { key: "Bound", value: "maxRepayBorrowAmount; excess is refunded" },
          {
            key: "Partial repay",
            value: "collateralCountToReturn; may mint a replacement loan NFT",
          },
          { key: "ERC-20", value: "prior approval, or a Permit2 allowance passed in the call" },
        ],
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/RepayDialog.tsx`,
            label: "Repayment implementation",
          },
        ],
      },
    ],
  },
  {
    id: "operator-operations",
    part: "App builders",
    audience: ["frontend"],
    title: "Operator actions",
    summary:
      "Expose only the actions the deployment granted, resolved per chain. An operator is never an owner.",
    paragraphs: [
      "Build each write from freshly resolved contracts, operator address, permission IDs, and project state, and simulate each chain on its own. A multisig proposal is pending until its Safe transaction executes; do not show success or invalidate state at proposal time.",
      "Shop tiers sit outside stage economics. Whether transfers are paused is a per-stage flag fixed at launch (build721RulesetMetadata); whether the operator can add tiers, update metadata, change discounts, or mint depends on the hook's flags and the permissions the 721 overload granted.",
    ],
    table: {
      label: "Operator write map",
      rows: [
        ["Metadata", "JBController.setUriOf"],
        ["Split redirect", "JBController.setSplitGroupsOf"],
        ["Transfer role", "REVOwner.setOperatorOf"],
        ["Add shop tiers", "JB721TiersHook.adjustTiers"],
        ["Operator mint", "JB721TiersHook.mintFor"],
        ["Buyback hook", "JBBuybackHookRegistry.setHookFor"],
        ["Router terminal", "JBRouterTerminalRegistry.setTerminalFor"],
        ["TWAP window", "JBBuybackHook.setTwapWindowOf"],
        ["Initialize pool", "JBBuybackHookRegistry.initializePoolFor"],
        ["Add chains", "REVDeployer.deploySuckersFor"],
      ],
    },
    codePoints: [
      {
        title: "Simulate with the operator, then write",
        code: [
          "const { request } = await publicClient.simulateContract({",
          "  account: operator,",
          "  address: hook,",
          "  abi: jb721TiersHookAbi,",
          '  functionName: "adjustTiers",',
          "  args: [tierConfigurations, tiersToRemove],",
          "});",
          "",
          "const hash = await walletClient.writeContract(request);",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/operator/OperatorAccountCard.tsx`,
            label: "Operator transfer implementation",
          },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/shop/AddItemsModal.tsx`,
            label: "Shop tier writes",
          },
        ],
      },
    ],
    note: "For the explicit no-operator setting, pass address(0). Relinquishing to it is permanent. The site's dead-address default is intended to be inaccessible, but it is not the zero-address mechanism; display the actual value and inspect permissions instead of inferring authority from a label.",
  },
  {
    id: "move-across-chains",
    part: "App builders",
    audience: ["frontend"],
    title: "Move across chains",
    summary:
      "A cross-chain move has separate stages: prepare on the source chain, send through a bridge, obtain a proof, then claim on the destination. Accounting sync is a separate operation; a source receipt does not mean destination funds are ready.",
    table: {
      label: "Sucker sequence",
      rows: [
        ["1. prepare (source)", "burn the tokens and queue a leaf"],
        ["2. toRemote (source)", "send the tree root through the bridge"],
        ["3. claim (destination)", "prove the leaf and mint the tokens"],
        ["syncAccountingData", "push the local balance snapshot to the peer, separately"],
      ],
    },
    paragraphs: [
      "A prepared move is not delivered value. Track its source sucker, peer sucker, token mapping, leaf index, beneficiary, proof, transport, fees, and status. CCIP and native bridges need different value and take different times; discover the payable value by simulating the exact call.",
      "Accounting sync changes the displayed group backing without moving any local balance. Keep queued, in transit, claimable, claimed, failed, and retriable distinct.",
    ],
    codePoints: [
      {
        title: "Builders",
        details: [
          { key: "1. Prepare", value: "buildBridgePrepareTx → sucker.prepare" },
          { key: "2. Send", value: "buildToRemoteTx → sucker.toRemote" },
          {
            key: "3. Claim",
            value: "buildBridgeClaimTx → peerSucker.claim, or claimFromSuckerMovement",
          },
          { key: "Accounting", value: "buildSyncAccountingDataTx → sucker.syncAccountingData" },
          { key: "Peers", value: "getV6SuckerPairs; movements via getSuckerMovements" },
        ],
        code: [
          "const prepare = buildBridgePrepareTx({",
          "  chainId, sucker, projectTokenCount, beneficiary,",
          "  minTokensReclaimed, token, metadata,",
          "});",
          "",
          "const send = buildToRemoteTx({ chainId, sucker, token, value: bridgeFee });",
          "const claim = buildBridgeClaimTx({ chainId: peerChainId, sucker: peer, claim: proof });",
          "const sync = buildSyncAccountingDataTx({ chainId, sucker, value: syncFee });",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/lib/bridgePrepare.ts`,
            label: "Protected prepare builder",
          },
          { href: `${REFERENCE_ROOT}/src/lib/v6/suckerProofs.ts`, label: "Proof and claim flow" },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/owners/settlement/lib.ts`,
            label: "Settlement state machine",
          },
        ],
      },
    ],
  },
  {
    id: "wallets-safe-relayr",
    part: "App builders",
    audience: ["frontend"],
    title: "Wallets, Safes, Relayr, and Permit2",
    summary:
      "Four kinds of signing show up in a revnet app: a plain wallet write, a Safe proposal, a Relayr bundle for many chains at once, and a Permit2 signature for pool swaps. Each has its own reviewed path here.",
    table: {
      label: "Signing paths in this site",
      rows: [
        [
          "Wallet write",
          "useReviewedWriteContract: review → switch chain → simulate as the connected account → send with gas headroom → wait for the receipt",
        ],
        [
          "Safe",
          "The Safe App connector plus the transaction service: proposals are polled, never reported as done; a same-address Safe can be deployed on a new chain from src/lib/safeDeployment.ts",
        ],
        [
          "Relayr",
          "One exact ERC-2771 authorization per destination chain, posted as a prepaid bundle; choose a funding chain and pay once for multichain launch, metadata edits, and operator writes",
        ],
        [
          "Permit2",
          "Only for direct Uniswap V4 swaps; pay and repay use a plain approve for the exact amount",
        ],
      ],
    },
    paragraphs: [
      "RPC goes through Juicebox Center, an origin-allowlisted provider with no client-side key; wallets connect through injected, WalletConnect, Coinbase, Safe, and an embedded Para wallet that also provides the card on-ramp. Every write hook switches the wallet to the target chain before it does anything else.",
      "Cross-chain authority is a real constraint: a Safe's L1 and L2 singletons differ, so a Safe that operates a revnet on one chain may not exist at the same address on another. Check before offering an operator action there.",
    ],
    links: [
      { href: `${REFERENCE_ROOT}/src/hooks/useReviewedWriteContract.ts`, label: "Reviewed write" },
      { href: `${REFERENCE_ROOT}/src/hooks/useReviewedRelayr.ts`, label: "Relayr bundle" },
      { href: `${REFERENCE_ROOT}/src/lib/safe-queue.ts`, label: "Safe queue" },
      { href: `${REFERENCE_ROOT}/src/lib/wagmiConfig.ts`, label: "Wallet config" },
      {
        href: `${SKILLS}/jb-relayr/SKILL.md`,
        label: "Relayr integration skill",
      },
    ],
  },
  {
    id: "metadata-and-ipfs",
    part: "App builders",
    audience: ["frontend"],
    title: "Metadata and IPFS",
    summary:
      "A revnet's name, logo, description, and links are one JSON file on IPFS, referenced by the project's uri. Read it through the SDK; pin new versions through Juicebox Center.",
    points: [
      {
        key: "Shape",
        text: "JBProjectMetadata: name, description, projectTagline, logoUri, coverImageUri, infoUri, payButton, payDisclosure, tags, twitter, telegram, discord, archived.",
      },
      {
        key: "Read",
        text: "getProjectMetadata(publicClient, { jbControllerAddress, projectId }) resolves the uri and fetches it; ipfsUri / cidFromIpfsUri handle the encoding.",
      },
      {
        key: "Pin",
        text: "this site pins JSON, images (25 MB), and media (500 MB) straight from the browser to Juicebox Center, which guards against empty files. The gateway is juicebox.center/ipfs/.",
      },
      {
        key: "Write",
        text: "the operator updates the pointer with JBController.setUriOf (SET_PROJECT_URI).",
      },
    ],
    links: [
      {
        href: `${REFERENCE_ROOT}/src/app/create/helpers/pinProjectMetaData.ts`,
        label: "Pinning at launch",
      },
      { href: `${REFERENCE_ROOT}/src/lib/jbcenter-ipfs.ts`, label: "Juicebox Center IPFS client" },
    ],
  },
  {
    id: "transaction-boundary",
    part: "App builders",
    audience: ["frontend"],
    title: "One transaction boundary",
    summary:
      "The request you quote, simulate, decode, show, and submit must be the same object, not five reconstructions of it.",
    diagrams: [
      {
        label: "Build → simulate → decode → review → write → confirm",
        description:
          "Refresh the state, build one transaction request, simulate it as the actual account, decode the call for user review, submit that request, and wait for a successful receipt. A wallet signature or Safe proposal alone is not confirmation.",
        lines: [
          "  fresh reads",
          "    → pure builder",
          "      → simulateContract with the real account",
          "        → encode and decode the calldata, show it to the user",
          "          → writeContract",
          "            → waitForTransactionReceipt",
          '              → success only on receipt.status === "success"',
        ],
      },
    ],
    paragraphs: [
      "Right before signing, refresh the reads that set bounds and permissions, rebuild, simulate with the real account, then decode the calldata and present it. After submission, keep wallet rejection, Safe proposal, inclusion, revert, and confirmed success as separate states. Only confirmed success invalidates reads.",
      "This site enforces it mechanically: requireTransactionReview re-encodes the request after the user has seen it and throws if anything changed, and a build-time script rejects any wallet write outside the four reviewed hooks.",
    ],
    codePoints: [
      {
        title: "Reference boundary",
        code: [
          "const tx = buildOperation(freshState, userInput);",
          "",
          "const { request } = await publicClient.simulateContract({ ...tx, account });",
          "",
          "const calldata = encodeFunctionData(tx);",
          "const decoded = decodeFunctionData({ abi: tx.abi, data: calldata });",
          "await review({ ...tx, calldata, decoded });",
          "",
          "const hash = await walletClient.writeContract(request);",
          "const receipt = await publicClient.waitForTransactionReceipt({ hash });",
          'if (receipt.status !== "success") throw new Error("Transaction reverted");',
        ].join("\n"),
        links: [
          { href: `${REFERENCE_ROOT}/src/lib/transaction-review.ts`, label: "Review decoder" },
          {
            href: `${REFERENCE_ROOT}/scripts/check-wallet-write-sites.mjs`,
            label: "Write-site inventory check",
          },
          { href: `${SKILLS}/jb-interact-ui/SKILL.md`, label: "Transaction interface skill" },
        ],
      },
    ],
  },
  {
    id: "run-this-site",
    part: "App builders",
    audience: ["frontend"],
    title: "Run this site locally",
    summary:
      "Run the reference web client to inspect a complete payment, launch, or holder flow. Start with its README and environment example; use the repository's pinned Node version.",
    codePoints: [
      {
        title: "Start a local development server",
        code: [
          "git clone https://github.com/mejango/revnet-money.git",
          "cd revnet-money",
          "# Install the Node version from .nvmrc with your Node version manager.",
          "cp .env.example .env.local",
          "npm ci",
          "npm run dev",
          "# Open http://localhost:3002",
        ].join("\n"),
      },
    ],
    table: {
      label: "Commands",
      rows: [
        ["npm run dev", "Next.js on port 3002"],
        [
          "npm run check",
          "The release-equivalent gate: dependencies, types, lint, format, protocol checks, unit tests, build, bundle, and browser tests",
        ],
        ["npm test", "Run unit and integration tests with Vitest"],
        [
          "npm run build:browser && npm run test:browser",
          "Build with deterministic fixtures, then run Playwright; a normal production build uses different endpoints",
        ],
        ["npm run wallet-writes:check", "Fails if any wallet write bypasses the reviewed hooks"],
      ],
    },
    points: [
      {
        key: "Env",
        text: "NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_BENDYSTRAW_URL, NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL, NEXT_PUBLIC_PARA_API_KEY, NEXT_PUBLIC_PARA_ENV, NEXT_PUBLIC_VERSION; WalletConnect and the on-ramp provider are optional. No RPC or IPFS keys live in the client.",
      },
      {
        key: "Tests",
        text: "PR tests use fixtures; nothing in them reaches a wallet, an RPC, the index, or Relayr.",
      },
    ],
    links: [
      { href: "https://github.com/mejango/revnet-money", label: "Repository" },
      { href: "https://github.com/mejango/revnet-money/blob/main/TESTING.md", label: "TESTING.md" },
    ],
  },

  // ------------------------------------------------------------------ Contract builders
  {
    id: "extension-points",
    part: "Contract builders",
    audience: ["contracts"],
    title: "What you can plug in, and what you cannot",
    summary:
      "A revnet's pay and cash out paths are fixed by REVOwner. You extend a revnet around those paths, not inside them.",
    paragraphs: [
      "REVOwner is hard-wired as the project's ruleset data hook. On a payment it asks the revnet's 721 hook for its one tier split, then asks the buyback hook whether the pool is the better route, and returns at most those two specifications. On a cash out it returns the buyback specification, if any, and its own fee specification. deployFor has no field for a third-party hook, and hasMintPermissionFor answers yes only to REVLoans, the buyback hook, and registered suckers.",
    ],
    compare: {
      label: "Extension points",
      columns: ["You can", "You cannot"],
      rows: [
        [
          "Route the split share to a split hook contract (IJBSplitHook)",
          "Install a custom data hook, pay hook, or cash out hook",
        ],
        [
          "Ship shop tiers with a custom IJB721TokenUriResolver",
          "Mint revnet tokens from your own contract",
        ],
        [
          "Allow Croptop posting categories at launch (allowedPosts)",
          "Add ruleset flags beyond the extraMetadata bits",
        ],
        ["Choose which sucker deployers link the chains", "Change stage economics after launch"],
        [
          "Build anything that pays into, reads, or wraps the revnet: project payers, routers, terminal wrappers, keepers",
          "Take the project NFT back from REVOwner",
        ],
      ],
    },
    links: [
      { href: `${REV_CORE}/REVOwner.sol`, label: "REVOwner.sol" },
      { href: `${REV_CORE}/REVDeployer.sol`, label: "REVDeployer.sol" },
    ],
  },
  {
    id: "split-hooks",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Split hooks: the main extension point",
    summary:
      "A stage's split recipients can be contracts. When the split share is distributed, the controller hands your contract its tokens and calls processSplitWith. This is how the LP split hook seeds pool liquidity from revenue.",
    paragraphs: [
      "Splits live in group 1 (RESERVED_TOKENS). Set the split's hook field to your contract's address. For an ERC-20 token, the controller grants an allowance: pull the tokens during the callback or the unconsumed amount is revoked and burned. For credits, it transfers them to the hook before the callback. A callback revert emits SplitHookReverted without blocking distribution; unpulled ERC-20 tokens are burned, while transferred credits remain at the hook.",
    ],
    codePoints: [
      {
        title: "IJBSplitHook",
        details: [
          {
            key: "Function",
            value: "processSplitWith(JBSplitHookContext calldata) external payable",
          },
          {
            key: "Context",
            value:
              "token, amount, decimals (18), projectId, groupId, split (percent, projectId, beneficiary, preferAddToBalance, lockedUntil, hook)",
          },
          {
            key: "Caller",
            value:
              "JBController; the reserved-token path does not check ERC-165, but implement it anyway",
          },
        ],
        code: [
          "// ERC-20-only fragment. Define CONTROLLER, PROJECT_ID, and PROJECT_TOKEN",
          "// in your contract; inherit ReentrancyGuard and implement IERC165.",
          "using SafeERC20 for IERC20;",
          "",
          "function processSplitWith(JBSplitHookContext calldata context) external payable nonReentrant {",
          "    if (msg.sender != address(CONTROLLER)) revert Unauthorized();",
          "    if (context.projectId != PROJECT_ID) revert BadProject();",
          "    if (context.groupId != 1 || address(context.split.hook) != address(this)) revert BadSplit();",
          "    if (context.token == address(0) || context.token != PROJECT_TOKEN) revert BadToken();",
          "",
          "    // ERC-20: pull it now; the allowance is revoked (and the remainder burned) after this call.",
          "    IERC20(context.token).safeTransferFrom(msg.sender, address(this), context.amount);",
          "    // ... do the thing: LP, vest, distribute, forward to another project.",
          "}",
        ].join("\n"),
        links: [
          { href: `${NANA_CORE}/interfaces/IJBSplitHook.sol`, label: "IJBSplitHook.sol" },
          { href: `${NANA_CORE}/structs/JBSplitHookContext.sol`, label: "JBSplitHookContext.sol" },
          {
            href: "https://github.com/Bananapus/nana-univ4-lp-split-hook-v6",
            label: "LP split hook (worked example)",
          },
          { href: `${SKILLS}/jb-split-hook/SKILL.md`, label: "jb-split-hook skill" },
        ],
      },
    ],
    note: "sendReservedTokensToSplitsOf has no reentrancy guard. Add nonReentrant, and treat the burn-on-unconsumed-allowance rule as a real hazard: a hook that under-pulls loses those tokens permanently.",
  },
  {
    id: "hook-interfaces",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Hooks on the projects around a revnet",
    summary:
      "A revnet will not run your pay or cash out hook, but the Juicebox projects that pay into it, sit beside it, or wrap it will. These are the four interfaces, and how metadata reaches them.",
    table: {
      label: "Interfaces (all extend IERC165)",
      rows: [
        [
          "IJBRulesetDataHook",
          "beforePayRecordedWith(ctx) → (weight, JBPayHookSpecification[]); beforeCashOutRecordedWith(ctx) → (cashOutTaxRate, cashOutCount, totalSupply, effectiveSurplusValue, JBCashOutHookSpecification[]); hasMintPermissionFor(projectId, ruleset, addr)",
        ],
        [
          "IJBPayHook",
          "afterPayRecordedWith(JBAfterPayRecordedContext) payable — payer, projectId, rulesetId, amount, forwardedAmount, weight, newlyIssuedTokenCount, beneficiary, hookMetadata, payerMetadata",
        ],
        [
          "IJBCashOutHook",
          "afterCashOutRecordedWith(JBAfterCashOutRecordedContext) payable — holder, projectId, rulesetId, cashOutCount, reclaimedAmount, forwardedAmount, cashOutTaxRate, beneficiary, hookMetadata, cashOutMetadata",
        ],
        ["IJBSplitHook", "processSplitWith(JBSplitHookContext) payable — see the previous section"],
      ],
    },
    points: [
      {
        key: "Funds",
        text: "native value arrives as msg.value; ERC-20 forwarding uses an allowance to pull during the call, revoked afterwards. Fees depend on the path: an ordinary incoming payment hook is not automatically charged 2.5%. Validate the actual forwarded amount and use SafeERC20 for transfers.",
      },
      {
        key: "Two metadatas",
        text: "hookMetadata is authored by the ruleset data hook; payerMetadata and cashOutMetadata originate with the caller. Authenticate the terminal, project, and expected data hook before relying on that origin, and validate both payloads. A legitimate shared terminal can call your hook for a different project.",
      },
      {
        key: "Metadata format",
        text: "JBMetadataResolver: a reserved first word, then a table of 4-byte ids with word offsets, then 32-byte-aligned blobs. createMetadata(ids, datas), addToMetadata, getDataFor(id, metadata). Ids are getId(purpose, target) = bytes4(bytes20(target) ^ bytes20(keccak256(purpose))).",
      },
      {
        key: "noop",
        text: "a specification with noop = true is informational; the terminal never calls it. That is how a hook reports a decision without receiving funds.",
      },
      {
        key: "Reentrancy",
        text: "pay and cashOutTokensOf call hooks after recording state without a global reentrancy guard. Protect your hook's state and external calls; nonReentrant alone does not validate who called or which project is involved. Use override(ERC165, IERC165) for supportsInterface when inheriting both.",
      },
    ],
    links: [
      { href: `${NANA_CORE}/interfaces/IJBRulesetDataHook.sol`, label: "IJBRulesetDataHook.sol" },
      { href: `${NANA_CORE}/interfaces/IJBPayHook.sol`, label: "IJBPayHook.sol" },
      { href: `${NANA_CORE}/interfaces/IJBCashOutHook.sol`, label: "IJBCashOutHook.sol" },
      { href: `${NANA_CORE}/libraries/JBMetadataResolver.sol`, label: "JBMetadataResolver.sol" },
      { href: `${SKILLS}/jb-pay-hook/SKILL.md`, label: "jb-pay-hook skill" },
      { href: `${SKILLS}/jb-cash-out-hook/SKILL.md`, label: "jb-cash-out-hook skill" },
    ],
  },
  {
    id: "install-and-deploy-from-solidity",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Install the code and deploy from Solidity",
    summary:
      "The V6 repos ship as npm packages and import by package path. deployFor takes the whole revnet as structs; every field is listed here with its unit.",
    table: {
      label: "Packages (Solidity 0.8.28)",
      rows: [
        ["@rev-net/core-v6", "REVDeployer, REVOwner, REVLoans"],
        [
          "@bananapus/core-v6",
          "Terminals, controller, tokens, splits, permissions, the hook interfaces",
        ],
        ["@bananapus/721-hook-v6", "Shop tiers"],
        ["@bananapus/buyback-hook-v6", "Pool routing"],
        ["@bananapus/suckers-v6", "Cross-chain"],
        ["@bananapus/router-terminal-v6", "Token routing"],
        ["@croptop/core-v6, @bananapus/permission-ids-v6", "Posting, permission constants"],
      ],
    },
    paragraphs: [
      'npm i the packages you need and import by path (import "@rev-net/core-v6/src/REVDeployer.sol"). remappings.txt in every repo only maps forge-std; node_modules resolves the rest. That is also how the deploy artifacts record source names.',
    ],
    codePoints: [
      {
        title: "REVDeployer.deployFor, field by field",
        details: [
          {
            key: "Signature",
            value:
              "deployFor(uint256 revnetId, REVConfig, JBAccountingContext[], REVSuckerDeploymentConfig, REVDeploy721TiersHookConfig, REVCroptopAllowedPost[]) payable → (revnetId, IJB721TiersHook)",
          },
          {
            key: "Short form",
            value:
              "the 4-argument overload deploys an empty shop with the base currency and 18 decimals",
          },
          {
            key: "revnetId",
            value:
              "0 creates a project; msg.value must equal JBProjects.creationFee(). A non-zero id must be owned by the caller, sends no value, and hands the NFT to REVOwner for good",
          },
          {
            key: "REVConfig",
            value:
              "description { name, ticker, uri, salt }, baseCurrency (uint32), operator, scopeCashOutsToLocalBalances, stageConfigurations[]",
          },
          {
            key: "REVStageConfig",
            value:
              "startsAtOrAfter (uint48, strictly increasing; 0 = now for the first), autoIssuances[] { chainId, count (uint104), beneficiary }, splitPercent (uint16, of 10,000), splits[] (JBSplit), initialIssuance (uint112, 18-dec tokens per base unit; 1 = inherit), issuanceCutFrequency (uint32 seconds), issuanceCutPercent (uint32, of 1e9), cashOutTaxRate (uint16, of 10,000, below 10,000), extraMetadata (uint16; bit 2 allows adding chains)",
          },
          {
            key: "JBAccountingContext",
            value:
              "token, decimals (uint8), currency (uint32; by convention uint32(uint160(token)))",
          },
          {
            key: "REVSuckerDeploymentConfig",
            value: "deployerConfigurations[], salt (0 skips sucker deployment)",
          },
          {
            key: "REVDeploy721TiersHookConfig",
            value:
              "baseline721HookConfiguration { name, symbol, baseUri, tokenUriResolver, contractUri, tiersConfig, flags }, salt, preventOperatorAdjustingTiers / UpdatingMetadata / Minting / IncreasingDiscountPercent",
          },
          {
            key: "REVCroptopAllowedPost",
            value:
              "category (uint24), minimumPrice (uint104), minimumTotalSupply, maximumTotalSupply, maximumSplitPercent (uint32), allowedAddresses[]",
          },
        ],
        code: [
          "// Resolve the deployed contracts and construct the structs before this fragment.",
          "// For matching chains, use the same explicit first-stage start and configuration hash.",
          "(uint256 revnetId, IJB721TiersHook hook) = REV_DEPLOYER.deployFor{value: PROJECTS.creationFee()}({",
          "    revnetId: 0,",
          "    configuration: config,",
          "    accountingContextsToAccept: contexts,",
          "    suckerDeploymentConfiguration: suckers,",
          "    tiered721HookConfiguration: shop,",
          "    allowedPosts: new REVCroptopAllowedPost[](0)",
          "});",
        ].join("\n"),
        links: [
          { href: `${REV_CORE}/REVDeployer.sol`, label: "REVDeployer.sol" },
          { href: `${REV_CORE}/structs/REVStageConfig.sol`, label: "REVStageConfig.sol" },
          { href: `${SKILLS}/jb-deploy-ui/SKILL.md`, label: "Launch interface skill" },
        ],
      },
    ],
    note: "The configuration hash covers the description's name, ticker, and salt; base currency; balance scope; and each stage's effective start, split percent, issuance, cuts, tax, extraMetadata, and auto issuances. It excludes split recipients. A first-stage start of 0 becomes the execution timestamp, so sending 0 independently on several chains can produce different hashes. Keep the origin's effective configuration, sender, salts, and deployment addresses when adding a chain; verify every resulting token and bridge pair.",
  },
  {
    id: "loans-from-contracts",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Loans from a contract",
    summary:
      "REVLoans is callable by any contract that holds the right permission from the token holder. Liquidation is permissionless, which makes it a keeper job.",
    table: {
      label: "REVLoans surface",
      rows: [
        [
          "borrowFrom(revnetId, token, minBorrowAmount, collateralCount, beneficiary, prepaidFeePercent, holder)",
          "OPEN_LOAN (37) from holder; returns (loanId, REVLoan)",
        ],
        [
          "repayLoan(loanId, maxRepayBorrowAmount, collateralCountToReturn, beneficiary, allowance) payable",
          "REPAY_LOAN (39) from the loan NFT owner; excess value refunded",
        ],
        [
          "reallocateCollateralFromLoan(loanId, collateralCountToTransfer, token, minBorrowAmount, collateralCountToAdd, beneficiary, prepaidFeePercent)",
          "REALLOCATE_LOAN (38), plus OPEN_LOAN when adding collateral",
        ],
        [
          "liquidateExpiredLoansFrom(revnetId, startingLoanId, count)",
          "Anyone, after the ten-year expiry",
        ],
        [
          "borrowableAmountFrom, loanOf, loanSourceTokensOf, determineSourceFeeAmount",
          "Views for quoting",
        ],
      ],
    },
    paragraphs: [
      "A holder acting for themselves needs no grant. A contract acting for a holder needs JBPermissions.setPermissionsFor from that holder, scoped to the revnet (ROOT works but is far too broad). Every mutating call runs under a loan-specific reentrancy guard; the collateral is burned when the loan opens and minted again when it closes.",
    ],
    links: [
      { href: `${REV_CORE}/REVLoans.sol`, label: "REVLoans.sol" },
      { href: `${SKILLS}/jb-revloans/SKILL.md`, label: "jb-revloans skill" },
    ],
  },
  {
    id: "test-contracts",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Test against the real thing",
    summary:
      "The revnet repo ships a local workflow base and a mainnet fork base. Use both: the first for logic, the second against the deployed contracts.",
    table: {
      label: "Foundry bases",
      rows: [
        [
          "TestBaseWorkflow",
          "From @bananapus/core-v6/test/helpers; deploys a full local protocol. Most revnet tests extend it",
        ],
        [
          "ForkTestBase",
          "revnet-core-v6/test/fork; forks Ethereum at a pinned block via the RPC_ETHEREUM_MAINNET env var and foundry.toml's rpc_endpoints",
        ],
        [
          "Helpers",
          "_buildMinimalConfig(cashOutTaxRate), _build721Config(), _deployRevnet, a Uniswap V4 LiquidityHelper, and MaliciousContracts for reentrancy cases",
        ],
      ],
    },
    points: [
      {
        key: "Sizes",
        text: "REVDeployer and REVOwner were split to fit EIP-170; the buyback hook dropped getters for the same reason. Check forge build --sizes early, and plan for library extraction if you are close.",
      },
      {
        key: "Bytecode parity",
        text: "verify your deployment against the deploy-all-v6 artifacts rather than trusting a source match; linked libraries change the hash.",
      },
    ],
    links: [
      {
        href: "https://github.com/rev-net/revnet-core-v6/tree/main/test",
        label: "revnet-core-v6 tests",
      },
      {
        href: "https://github.com/Bananapus/nana-core-v6/tree/main/test/helpers",
        label: "TestBaseWorkflow",
      },
    ],
  },
  {
    id: "sharp-edges",
    part: "Contract builders",
    audience: ["contracts", "frontend"],
    title: "Sharp edges",
    summary:
      "Implementation details that can change the meaning or safety of an otherwise valid call.",
    points: [
      {
        key: "Who is the payer",
        text: "JBMultiTerminal records its ERC-2771-resolved caller as the payer. A wrapper can therefore be the payer even when a human funded it. Router integrations may probe originalPayer() for fee or refund attribution; that does not rewrite the terminal's payer context or authenticate a human. Set the token beneficiary explicitly.",
      },
      {
        key: "Buyback metadata is three words",
        text: 'the pay metadata under getId("pay") for the buyback hook decodes as (amountToSwapWith, minimumSwapAmountOut, skipSplits). Always encode all three; older hook versions tolerate a trailing third word, the current one requires it.',
      },
      {
        key: "hookMetadata is not yours",
        text: "the buyback hook uses an internal tuple that is not an application input format. Caller metadata is untrusted, and hook metadata is only as trustworthy as the authenticated caller, project, and configured data hook. Do not decode it as a user-controlled request.",
      },
      {
        key: "Sucker cash outs",
        text: "the registered sucker's source-chain cash out is untaxed and skips the launch lock, using local backing only. This permits bridge accounting. Tokens received by an ordinary holder on the destination do not acquire an exemption for a later cash out.",
      },
      {
        key: "Router terminal cold start",
        text: "the router registry reverts accountingContextForTokenOf for projects below its threshold; it is not universally accepting. Probe with previewPayFor before assuming a route.",
      },
      {
        key: "The 7-day lock",
        text: "a first stage whose start is already past at execution locks cash outs and loans for seven days on that chain. Relevant to Safe proposals and to scripted multichain launches.",
      },
      {
        key: "Burned allowance",
        text: "a split hook that leaves allowance unspent loses those tokens; the controller burns the remainder.",
      },
    ],
    links: [
      { href: "https://github.com/Bananapus/nana-buyback-hook-v6", label: "Buyback hook source" },
      { href: `${SKILLS}/jb-terminal-selection/SKILL.md`, label: "jb-terminal-selection skill" },
      { href: `${SKILLS}/jb-suckers/SKILL.md`, label: "jb-suckers skill" },
    ],
  },

  // ------------------------------------------------------------------ Ship it safely
  {
    id: "test-and-verify",
    part: "Ship it safely",
    title: "Test what can surprise you",
    summary:
      "Test the builders you ship, at the edges where fixed economics, route changes, permissions, and asynchronous settlement bite.",
    points: [
      {
        key: "Launch",
        text: "the configuration round-trips through every supported ABI overload; a past nonzero first-stage start produces the documented seven-day lock; matching effective configuration, sender, salts, and deployment addresses produce the intended cross-chain token addresses.",
      },
      {
        key: "Payments",
        text: "the chosen route's executable minimum is no worse than the alternatives shown; an empty pool falls back to issuance; a router route is probed, not assumed.",
      },
      {
        key: "Cash outs",
        text: "the terminal or hook enforces the same minimum the confirmation shows, including at 0% fee-free surplus.",
      },
      {
        key: "Loans",
        text: "only the loan permissions (37, 38, 39) are granted, scoped to the revnet; repayment ceilings cannot underpay the live obligation; partial repay mints the replacement NFT.",
      },
      {
        key: "Operator",
        text: "no exposed call can change committed issuance, cuts, taxes, or split percentages; a Safe proposal is not success.",
      },
      {
        key: "Multichain",
        text: "one chain's project, token, decimals, operator, or proof is never reused on another; delayed claims stay claimable.",
      },
      {
        key: "Hooks",
        text: "reentrancy from a hostile hook or token, an under-pulling split hook, hostile payer metadata.",
      },
    ],
    paragraphs: [
      "Fork-test against the current deployments. Then publish the addresses, source, transaction map, and a human-readable stage schedule so users can check your product against the contracts themselves. The audit page has prompts for a whole-system review and for a single transaction.",
    ],
    links: [
      { href: "/audit", label: "Audit prompts and source index" },
      { href: "/learn#verify-before-trusting", label: "What users will check" },
      { href: "https://github.com/mejango/revnet-money", label: "Reference web client" },
    ],
  },
];

export default function BuildPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Build"
        title="Build with revnets"
        introduction="Choose a path: launch and run a revnet without code, connect an app using the V6 SDK, or build a Solidity integration. Start with the steps for your role, then use the transaction examples and source references as you need them."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <nav aria-label="Choose a building path" className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  href: "#launch-from-the-wizard",
                  title: "Launch without code",
                  description: "Prepare a draft, model the terms, and review a deployment.",
                },
                {
                  href: "#set-up",
                  title: "Connect an app",
                  description: "Set up the SDK, read a revnet, and build a payment flow.",
                },
                {
                  href: "#extension-points",
                  title: "Write a contract",
                  description: "Choose an extension point and test against the V6 contracts.",
                },
              ].map(({ href, title, description }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg border border-zinc-300 bg-white p-4 text-zinc-900 hover:border-melon-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
                >
                  <span className="block font-semibold underline decoration-melon-400 underline-offset-4">
                    {title}
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-zinc-700">
                    {description}
                  </span>
                </Link>
              ))}
            </nav>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox. The{" "}
              <Link
                href="https://juicebox.money/build"
                className="underline decoration-melon-400 underline-offset-4"
              >
                Juicebox build guide
              </Link>{" "}
              covers the protocol-level calls, hooks, and permissions.
            </p>
            <AgentSkillsNote
              skills={[
                "jb-deploy-ui",
                "revnet-economics",
                "jb-revloans",
                "jb-suckers",
                "jb-bendystraw",
                "jb-interact-ui",
              ]}
              prompt={<CopyRevnetBuildPrompt />}
            />
          </>
        }
        afterSections={
          <p className="leading-relaxed text-zinc-700">
            Start from the smallest operation your product needs, copy its reference pattern, and
            keep the live read, pure builder, simulation, review, and confirmation on one path. The
            complete working implementation is the{" "}
            <Link
              href="https://github.com/mejango/revnet-money"
              className="underline decoration-melon-400 underline-offset-4"
            >
              Revnet Money repository
            </Link>
            .
          </p>
        }
        companion={{
          href: "/learn",
          label: "How a revnet works",
          description:
            "Stages, the three prices, cash out taxes, loans, operators, and multichain, in plain language, before you turn them into product actions.",
        }}
      />
    </>
  );
}
