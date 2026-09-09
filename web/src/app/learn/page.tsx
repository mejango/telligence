import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Learn revnets",
  description:
    "What a revnet is, how money and tokens move through one, what stages, cash out taxes, loans, and operators do, and what to check before you trust one.",
  alternates: { canonical: "/learn" },
  openGraph: {
    title: "Learn revnets",
    description:
      "Understand payments, token terms, cash outs, and loans. Learn the basics or prepare your first revnet transaction.",
    url: "/learn",
    type: "website",
    images: [{ url: "/assets/img/revnet-social.png", width: 1428, height: 804, alt: "Revnet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Learn revnets",
    description:
      "Understand payments, token terms, cash outs, and loans. Learn the basics or prepare your first revnet transaction.",
    images: ["/assets/img/revnet-social.png"],
  },
};

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "start-here",
    part: "The basics",
    title: "Start with what you want to do",
    summary:
      "A revnet is a revenue network: payments can fund a shared balance and give people tokens connected to it. You can explore the terms without connecting a wallet.",
    points: [
      {
        key: "Understand a revnet",
        text: "Read the basics, then open a revnet's Terms tab for its full stage schedule and token allocations.",
      },
      {
        key: "Buy or use tokens",
        text: "Compare the amount you receive after splits and fees, the selected chain, and the current cash out quote before signing. A token is not automatically company equity or a right to a product.",
      },
      {
        key: "Launch your own",
        text: "Use the Build guide to choose the model and prepare a draft. The create page does not require coding; launch terms need careful review because they cannot be edited later.",
      },
    ],
    links: [
      { href: "/discover", label: "Explore revnets without a wallet" },
      { href: "#your-first-transaction", label: "Prepare your first transaction" },
      { href: "/build#launch-from-the-wizard", label: "Launch a revnet without code" },
      { href: "#glossary", label: "Look up an unfamiliar term" },
    ],
  },
  {
    id: "what-is-a-revnet",
    part: "The basics",
    title: "What a revnet is",
    summary:
      "A revnet is a Juicebox project owned by the REVOwner contract. Its launch configuration commits to a schedule for issuing tokens, allocating a share to contributors, and letting holders cash out or borrow against their tokens.",
    paragraphs: [
      "Customers and supporters pay the revnet. A payment can issue new tokens or buy existing ones through a market pool. Funds used for new issuance enter the revnet's balance; funds used for a market purchase pay the pool. The payer's token amount depends on the route and the stage's split share.",
      "The operator cannot rewrite the committed stage schedule or take a discretionary payout from the balance. Some settings remain adjustable, including split recipients and market routing. Those powers and the contracts' dependencies still matter when deciding whether to participate.",
      "Revnets are for open source projects, protocols, and any group that wants to share revenue with its contributors and customers without asking anyone to trust a treasury manager.",
    ],
    compare: {
      label: "Juicebox project vs revnet",
      columns: ["Juicebox project", "Revnet"],
      rows: [
        [
          "An owner can keep rule-changing powers, subject to the project's configuration",
          "REVOwner enforces the stage schedule committed at launch",
        ],
        [
          "Can budget payouts to a team",
          "Funds leave through configured token, loan, market, shop, and bridge flows",
        ],
        ["Good for teams, DAOs, funds", "Good for tokens, protocols, open businesses"],
      ],
    },
    note: "Choose a revnet when committed token economics fit the project. Choose a configurable Juicebox project when a team needs a spending budget or the ability to change its economic rules.",
    links: [
      { href: "/discover", label: "Explore live revnets" },
      { href: "/build#when-to-use-a-revnet", label: "Decide whether a revnet fits your product" },
    ],
  },
  {
    id: "how-money-flows",
    part: "The basics",
    title: "How money flows",
    summary:
      "Start with payments, cash outs, and loans. A market route or shop purchase can add another step, so always check where a payment actually goes.",
    diagrams: [
      {
        label: "The loop",
        description:
          "A payment can mint tokens and fund the balance, or buy tokens from a market pool. The stage allocates a share of new issuance to split recipients. A treasury cash out burns tokens for funds, while a loan burns collateral that can be restored through repayment.",
        lines: [
          "  1. Someone PAYS the revnet",
          "     └─▶ mint tokens into the payer and split allocations",
          "     └─▶ funds used for minting enter the balance",
          "     └─▶ or a buyback route buys existing tokens from a pool",
          "",
          "  2. Holders CASH OUT",
          "     └─▶ burn tokens, take a share of the balance",
          "     └─▶ the cash out tax decides how much stays for everyone else",
          "",
          "  3. Or holders BORROW against tokens instead of cashing out",
          "",
          "  simple backing per token = balance ÷ token supply",
          "  loans and other chains require additional accounting",
        ],
      },
    ],
    paragraphs: [
      "For a single-chain revnet with no loans, balance divided by total token supply is a useful starting point. With loans, the contracts also account for outstanding borrowed amounts and the collateral that can be restored. Some revnets include remote-chain accounting too. A backing estimate is not the amount available to withdraw right now.",
      "New issuance changes both balance and supply; backing per token can rise or fall depending on the issuance rate. Auto issuance adds supply without a payment. Cash out taxes retain value for remaining holders, while loans move funds out until repayment or expiry changes the accounting.",
      "Contributors receive the split share in tokens. To obtain ETH, USDC, or another asset, they must cash out, borrow, or find a buyer, subject to the same terms as other holders. There is no discretionary team payout budget.",
    ],
  },
  {
    id: "three-prices",
    part: "The basics",
    title: "The three prices",
    summary:
      "Issuance, cash out, and market prices answer different questions. Compare live quotes for your amount and chain; a chart is only a reference.",
    points: [
      {
        key: "Issuance price",
        text: "what a new token costs at the current stage's issuance rate. Your effective price also reflects the split share. Issuance may be zero, so new tokens are not always available at a finite price.",
      },
      {
        key: "Cash out price",
        text: "what a treasury cash out can return for a specified token amount. It depends on the tax, supply, backing, fees, and funds available on the selected chain. It changes with transaction size.",
      },
      {
        key: "Market price",
        text: "what a liquidity pool offers for a trade. Its displayed price can differ from the amount your trade achieves because trading moves the price and incurs fees.",
      },
    ],
    diagrams: [
      {
        label: "Compare routes, then compare the final quote",
        description:
          "When a market asks more than issuance, a buyer may prefer to mint. When a market pays less than cash out, a seller may prefer to cash out. These incentives do not enforce a guaranteed market floor or ceiling: fees, liquidity, delays, and price changes can prevent a profitable trade.",
        lines: [
          "  BUY   compare issuance with a market purchase",
          "  SELL  compare treasury cash out with a market sale",
          "",
          "  compare the amount received after splits, fees, and gas",
          "  market prices can move beyond either reference price",
        ],
      },
    ],
    paragraphs: [
      "Charts may call issuance a ceiling and cash out a floor. Those names describe incentives, not guaranteed market limits. Liquidity, transaction costs, launch locks, bridge delays, and changing state can keep a price outside those reference values. Use the transaction quote for the amount you intend to trade.",
    ],
  },
  {
    id: "stages",
    part: "The basics",
    title: "Stages",
    summary:
      "A revnet's rules change over time, but only along a schedule of stages that was written at launch. The current stage decides what happens now; the full list shows what happens later.",
    paragraphs: [
      "Each stage sets when it can start, how many tokens a payment issues, how fast that rate falls, what share of new tokens goes to splits, the cash out tax, and any auto issuance allocations that become claimable after the stage starts.",
    ],
    diagrams: [
      {
        label: "Example schedule",
        description:
          "Illustrative schedule: stage one starts on day zero, issues 1,000 tokens per ETH before a 30% split, cuts issuance by 10% every 30 days, and has a 20% cash out tax. Stage two starts on day 365, inherits the rate, cuts it by 5% every 90 days, and uses a 10% split and 50% tax. Stage three starts on day 1,825 with no new issuance and a 50% tax. Actual stage transitions follow their on-chain ruleset timing.",
        lines: [
          "  STAGE 1  day 0      1,000 tokens per ETH, cut 10% every 30 days",
          "                      split 30% to contributors, cash out tax 20%",
          "",
          "  STAGE 2  day 365    rate carries over, cut 5% every 90 days",
          "                      split 10%, cash out tax 50%",
          "",
          "  STAGE 3  day 1,825  issuance stops",
          "                      split 0%, cash out tax 50%, forever",
        ],
      },
    ],
    points: [
      {
        key: "Start",
        text: "the earliest timestamp the stage can take over; check the effective start shown in Terms.",
      },
      { key: "Issuance", text: "tokens issued per unit of the base currency paid." },
      {
        key: "Issuance cut",
        text: "a percentage the rate drops by on a fixed cadence, so earlier payers get more tokens for the same money.",
      },
      {
        key: "Split share",
        text: "the percent of every issuance that goes to the stage's split recipients rather than the payer.",
      },
      {
        key: "Cash out tax",
        text: "a parameter in the cash out curve, not a flat percentage deducted from every withdrawal.",
      },
      {
        key: "Auto issuance",
        text: "a fixed token allocation for named recipients, claimable after the stage starts without a payment. A transaction must claim it; it does not mint merely because time passes.",
      },
    ],
    note: "Always read the whole schedule, not just today's rate. A generous first stage followed by a harsh second one is a real deal that should be judged as a whole.",
  },
  {
    id: "cash-out-tax",
    part: "Going deeper",
    title: "Cash outs and the cash out tax",
    summary:
      "A treasury cash out burns tokens for funds. A positive cash out tax reduces the proportional amount returned when less than the full effective supply is cashed out, leaving value behind for remaining holders.",
    paragraphs: [
      "In the simplified example below, a 0% tax returns 10% of the balance for 10% of the supply. A 20% tax parameter returns 8.2 ETH, not 8 ETH: the formula also accounts for the share being cashed out. This example excludes fees, loans, remote balances, and market routing.",
    ],
    diagrams: [
      {
        label: "Worked example before fees",
        description:
          "With a balance of 100 ETH and a cash out of 10% of total supply, a 0% tax returns 10 ETH, 20% returns 8.2 ETH, 50% returns 5.5 ETH, and 80% returns 2.8 ETH, before fees. Multiply balance by the share, then by one minus the tax plus the tax times the share. Use 0.1 for a 10% share and 0.2 for a 20% tax.",
        lines: [
          "  balance 100 ETH, you hold 10% of the supply",
          "",
          "  tax  0%  → cash out returns 10.0 ETH",
          "  tax 20%  → cash out returns  8.2 ETH   (1.8 ETH stays)",
          "  tax 50%  → cash out returns  5.5 ETH   (4.5 ETH stays)",
          "  tax 80%  → cash out returns  2.8 ETH   (7.2 ETH stays)",
          "",
          "  returned = balance × share × ((1 − tax) + tax × share)",
        ],
      },
    ],
    points: [
      {
        key: "Size changes the effective tax",
        text: "for the same starting balance and supply, a larger share receives more per token. Splitting a withdrawal into smaller transactions does not create a discount; each transaction changes the state and adds gas costs.",
      },
      {
        key: "The tax is set per stage",
        text: "so a revnet can start liquid and become stickier as it matures, or the reverse.",
      },
      {
        key: "Fees",
        text: "a standard taxed treasury cash out includes a 2.5% Juicebox protocol fee and a Revnet fee calculated from 2.5% of the token count. These use different bases and are separate from the cash out tax. Even a 0% tax can incur a protocol fee on funds previously received through fee-free payouts. Check the net quote; a market route or fee exemption can change the result.",
      },
    ],
    links: [
      {
        href: "https://github.com/Bananapus/nana-core-v6/blob/main/src/libraries/JBCashOuts.sol",
        label: "Cash out formula in the contracts",
      },
      { href: "/build#cash-out", label: "How an app quotes cash outs" },
    ],
  },
  {
    id: "splits-and-auto-issuance",
    part: "Going deeper",
    title: "Splits and auto issuance",
    summary:
      "A stage can route a fixed share of every issuance to contributors, partners, or other revnets. That share is how a revnet pays the people building it.",
    paragraphs: [
      "The split share is a percentage of each issuance, fixed per stage. If the share is 30%, a payment that issues 1,000 tokens sends 700 to the payer and 300 to the split recipients. The recipients get tokens, never the balance itself.",
      "The operator can redirect split recipients while respecting allocations that are still locked, but cannot raise the committed split percentage. Auto issuance is a separate stated allocation, claimable for its named recipient after its stage starts. Anyone can trigger that claim; the tokens still go to the configured beneficiary.",
    ],
    note: "Both mechanisms affect who holds the supply. Payment issuance adds funds as well as tokens; auto issuance adds tokens without funds. On a multichain revnet the split share is the same on every chain, but recipients can differ. Include unclaimed allocations when considering future dilution.",
  },
  {
    id: "markets-and-buybacks",
    part: "Going deeper",
    title: "Markets and buybacks",
    summary:
      "A liquidity pool holds assets that people can trade. A revnet's buyback hook can use a configured pool when it offers a better rate than new issuance, or combine a market purchase with issuance.",
    paragraphs: [
      "The buyback hook is a contract called during a payment. Funds spent in the pool buy existing tokens from liquidity providers; they do not all enter the revnet's balance. The standard route applies the split share to the tokens obtained. Some integrations can opt out of splits on the purchased portion; newly minted tokens still follow the stage's split.",
      "Buying directly from a pool skips the revnet's payment path and split share, but it is not always the best deal. Compare the tokens you receive after all costs, including price movement caused by your trade. A shop purchase may require the payment path to receive the item.",
      "Cash outs can also use a configured pool when selling tokens there produces a better result. In that case the market supplies the funds; the treasury-only formula is not the complete quote. The confirmation should identify the route and enforce the minimum amount you accept.",
    ],
    note: "A pool may be absent or have too little liquidity for your amount. A displayed market price is not a promise of an executable trade. Check the live quote and its minimum output before signing.",
  },
  {
    id: "loans",
    part: "Going deeper",
    title: "Loans",
    summary:
      "A loan gives a holder funds now and a way to recover token collateral by repaying. The collateral tokens are burned while the loan is open, so they cannot also be spent or cashed out.",
    diagrams: [
      {
        label: "Loan lifecycle",
        description:
          "Borrowing burns collateral, sends funds after fees, and creates a transferable loan NFT. Repayment before expiry pays the required principal and any additional source fee to restore collateral. After 3,650 days the loan expires; a permissionless liquidation removes both its outstanding debt and collateral from accounting. No price-triggered margin call is part of this loan lifecycle.",
        lines: [
          "  borrow",
          "     └─▶ your tokens are burned as collateral",
          "     └─▶ the revnet sends you funds, minus fees",
          "     └─▶ you receive a loan NFT as your receipt",
          "",
          "  repay (before the 3,650-day expiry)",
          "     └─▶ return principal plus any additional time-based fee",
          "     └─▶ your collateral is minted back to you",
          "",
          "  expiry (after 3,650 days)",
          "     └─▶ the loan is written off, collateral stays burned",
          "     └─▶ liquidation removes both loan debt and collateral from accounting",
        ],
      },
    ],
    paragraphs: [
      "The amount you can borrow uses the current cash out tax and the revnet's effective backing, then is capped by funds available on the selected chain. A loan does not bypass a high cash out tax. Compare net proceeds, repayment cost, and the token rights you want to recover.",
      "A standard new loan deducts a 2.5% Juicebox protocol fee, a 1% REV fee where its fee payment is available, and your chosen prepaid source fee of 2.5% to 50%. The source fee returns to the lending revnet. You receive less than the recorded principal, but repayment is based on that principal, plus any additional time-based fee.",
      "The prepaid fee sets the window with no additional source fee: 2.5% covers 182.5 days; 50% covers the full 3,650 days. After that window, the additional source fee increases until expiry. Read the exact repayment quote and expiry timestamp; waiting past expiry permanently loses the right to recover collateral.",
      "Outstanding loan principal counts in backing and burned collateral counts in effective supply while the claim exists. After expiry, anyone can liquidate the loan to remove both. Expiry does not send new money into the balance or guarantee a higher value per remaining token. Transferring the loan NFT transfers control of the loan, including the right to recover its collateral.",
    ],
    links: [
      {
        href: "https://github.com/rev-net/revnet-core-v6/blob/main/src/REVLoans.sol",
        label: "Loan rules and fee calculation",
      },
      { href: "/build#operate-loans", label: "Integrate loan quotes and repayment" },
    ],
  },
  {
    id: "shops",
    part: "Going deeper",
    title: "Shops",
    summary:
      "A revnet can sell items through a shop. A qualifying payment can mint an item NFT alongside revnet tokens, subject to the item's price, supply, and payment rules.",
    paragraphs: [
      "Items are organised into categories and can have supply limits, prices, token splits, discounts, and transfer rules. Some shop configurations route part of an item payment to another recipient, so check the purchase breakdown. The operator may keep powers to change shop settings or mint items.",
      "An NFT is an on-chain record. Any promised physical item, service, access, delivery, or refund depends on the seller's stated terms; the token itself does not fulfil that promise. Read the item description and check the seller before buying.",
    ],
  },
  {
    id: "multichain",
    part: "Under the hood",
    title: "One revnet, many chains",
    summary:
      "A revnet can run on several Ethereum chains at once. Each chain has its own balance and token supply, running the same stage schedule in sync.",
    paragraphs: [
      "Payments and cash outs execute on the selected chain once the transaction is included. Ordinary cash out and loan accounting may include remote balances and supply, depending on the launch configuration, but actual withdrawals are limited by local funds.",
      "A cross-chain move uses bridge contracts called suckers. They cash tokens out using the source chain's local backing without the normal cash out tax, move the corresponding funds, and allow tokens to be claimed on the destination. This is a separate registered bridge path, not a tax exemption on a holder's later cash out.",
      "Cross-chain moves are asynchronous. A balance shown for the whole group can include value that is queued, in transit, or waiting to be claimed on the other side.",
      "Keep the source transaction and destination chain handy until the claim completes. A successful source transaction does not mean destination tokens are ready. Bridge messages, fees, and claim transactions can take additional time.",
    ],
  },
  {
    id: "operator",
    part: "Under the hood",
    title: "The operator",
    summary:
      "REVOwner is the on-chain project owner. An optional human or contract operator has limited permissions; it cannot rewrite the stage schedule, but its routing, allocation, and shop decisions can still affect users.",
    points: [
      {
        key: "Can",
        text: "update the name, description, and token metadata; redirect the precommitted split share; choose the buyback pool, its TWAP window, and the router terminal; manage sucker safety; and extend the revnet to new chains if the deployment allowed it. A revnet launched with a shop also lets the operator add items, set discounts, update item metadata, and mint.",
      },
      {
        key: "Cannot",
        text: "change issuance, cuts, cash out taxes, split percentages, or stage timing. Cannot withdraw the balance.",
      },
      { key: "Can hand over", text: "the role to another address, or to nobody." },
    ],
    note: "The zero address is the contract's explicit no-operator setting, and relinquishing to it is permanent. This site's create flow uses a dead address intended to be inaccessible when the operator is off. Inspect the actual address and permissions on every chain; do not infer control from an address label alone.",
  },
  {
    id: "built-on-juicebox",
    part: "Under the hood",
    title: "Built on Juicebox",
    summary:
      "A V6 revnet uses Juicebox's payment and token contracts with REVOwner as its project owner. It selects a constrained set of Juicebox features and removes the ordinary owner's ability to change the committed economic rules.",
    paragraphs: [
      "Juicebox supplies payments, tokens, rulesets, splits, cash outs, hooks, and cross-chain suckers. The Revnet contracts add the stage schedule, the cash out and loan economics, and the operator's limited permissions on top.",
      "If you want to understand rulesets, terminals, hooks, and fees at the protocol level, the Juicebox guide covers them in the same plain style.",
    ],
    links: [
      { href: "https://juicebox.money/learn", label: "Learn Juicebox" },
      { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 source" },
      { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 source" },
    ],
  },
  {
    id: "verify-before-trusting",
    part: "Under the hood",
    title: "What to check before you trust one",
    summary:
      "Revnets follow a known set of rules, but each revnet chooses its own numbers, recipients, chains, and operator. Read them.",
    points: [
      {
        key: "Stages",
        text: "the full schedule, especially the stage after the one you are paying into.",
      },
      {
        key: "Splits and auto issuance",
        text: "who receives tokens without paying, and how much.",
      },
      { key: "Chains", text: "which chains it runs on and whether the numbers match across them." },
      {
        key: "Balance and supply",
        text: "what backs a token today, and how much of the supply is in loans.",
      },
      { key: "Operator", text: "who it is and what they were granted." },
      {
        key: "Pool",
        text: "whether there is one, how much it can trade at your amount, and how its net quote compares with issuance or a treasury cash out.",
      },
      {
        key: "The transaction",
        text: "that what your wallet is about to sign matches the call this site describes.",
      },
    ],
    paragraphs: [
      "The code and transaction records are inspectable. Fixed stages limit owner discretion, but they do not guarantee token value, revenue, liquidity, or fulfilment of a team's promises. Check contract dependencies, operator permissions, and bridge and pricing assumptions alongside the economic terms.",
    ],
    links: [
      { href: "/audit", label: "Audit the contracts and this site" },
      { href: "https://github.com/mejango/revnet-money", label: "Website source" },
    ],
  },
  {
    id: "your-first-transaction",
    part: "Try it",
    title: "Your first transaction",
    summary:
      "Browse first, choose an amount, and connect a wallet when you are ready to act. Wallets hold your tokens and approve transactions on a particular chain.",
    points: [
      {
        key: "1. Choose the revnet",
        text: "Open Discover, then check the project's identity, Terms, token allocations, accepted assets, and operator. An attractive name or chart is not enough to identify the contract you mean to use.",
      },
      {
        key: "2. Choose the chain and amount",
        text: "Use an asset the payment flow accepts on that chain. Leave enough of the chain's gas token for transaction fees. Bridging from another chain takes a separate flow and can require another claim.",
      },
      {
        key: "3. Review what you receive",
        text: "Check the beneficiary address, split share, route, fees, and minimum token output. For a shop item, also check the NFT and seller's fulfilment terms. An ERC-20 approval authorizes spending; it may be followed by a separate payment transaction.",
      },
      {
        key: "4. Wait for confirmation",
        text: "A submitted transaction is pending until the chain confirms it. A Safe multisig proposal still needs execution. Keep the transaction link and check your holdings on the same chain if tokens are not immediately visible.",
      },
      {
        key: "5. Plan your next action",
        text: "Use the project's holder controls to quote cash out or borrowing. A zero quote can mean no available funds, a launch lock, or an unsupported route. Refresh the quote and check Terms before trying again; do not lower a minimum just to make an unexplained failure pass.",
      },
    ],
    links: [
      { href: "/discover", label: "Find a revnet to explore" },
      { href: "#verify-before-trusting", label: "Review the terms before signing" },
      { href: "/build#draft-files", label: "Save a launch draft before deploying" },
    ],
  },
  {
    id: "glossary",
    part: "Reference",
    title: "Words used in this guide",
    summary: "You do not need to know Solidity or DeFi terminology to read a revnet's terms.",
    points: [
      {
        key: "Balance / treasury",
        text: "assets held for a revnet in its payment contracts. Available local funds can differ from an aggregate backing estimate.",
      },
      {
        key: "Token / supply",
        text: "the revnet's units of participation, and the total number accounted for. Loan collateral and pending allocations matter when interpreting supply.",
      },
      {
        key: "Credits / ERC-20",
        text: "two ways the protocol records a token balance. Credits can be used within Juicebox; claiming turns them into ERC-20 tokens that compatible wallets and markets can use. Claiming does not create an extra economic allocation.",
      },
      {
        key: "Stage / ruleset",
        text: "a scheduled set of token and cash out terms. Juicebox calls the underlying configuration a ruleset.",
      },
      {
        key: "Issuance / mint / burn",
        text: "creating tokens, creating tokens on-chain, and destroying tokens. Loan collateral can be minted back only through the loan's permitted recovery flows.",
      },
      {
        key: "Split share",
        text: "the portion of issuance allocated to named recipients instead of the payer.",
      },
      {
        key: "Cash out tax",
        text: "the curve parameter that keeps part of a proportional treasury withdrawal for remaining holders. It is separate from a protocol fee or a government tax.",
      },
      {
        key: "Pool / liquidity / slippage",
        text: "assets available for trading, how much can be traded, and the difference between an expected result and execution. A minimum output limits how much deterioration you accept.",
      },
      {
        key: "Collateral / loan NFT",
        text: "tokens committed to a loan, and the transferable record controlling that loan and recovery of its collateral.",
      },
      {
        key: "Terminal / hook / sucker",
        text: "a payment-and-withdrawal contract, a contract called to customize an operation, and a bridge contract that moves a revnet's tokens and backing between chains.",
      },
      {
        key: "Gas / approval",
        text: "the network fee for a transaction, and permission for a contract to spend a token. Neither is the same as paying the revnet.",
      },
      {
        key: "TWAP",
        text: "time-weighted average price: a pool price averaged over a window, used in routing. It is a reference, not a guaranteed execution price.",
      },
    ],
  },
];

export default function LearnPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Learn"
        title="How a revnet works"
        introduction="Understand what happens to your money, what a revnet token lets you do, and which terms are fixed at launch. Start with the basics, check a specific question, or prepare your first transaction. No wallet or coding knowledge is needed to learn."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <nav aria-label="Choose a learning path" className="flex flex-wrap gap-3">
              {[
                { href: "#what-is-a-revnet", label: "Learn the basics" },
                { href: "#your-first-transaction", label: "Use a revnet" },
                { href: "#glossary", label: "Look up a term" },
                { href: "/build#launch-from-the-wizard", label: "Launch without code" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 underline decoration-melon-400 underline-offset-4 hover:border-melon-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox. The{" "}
              <Link
                href="https://juicebox.money/learn"
                className="underline decoration-melon-400 underline-offset-4"
              >
                Juicebox guide
              </Link>{" "}
              explains the protocol every revnet runs on.
            </p>
            <AgentSkillsNote skills={["revnet-economics", "revnet-modeler", "jb-revloans"]} />
          </>
        }
        companion={{
          href: "/build",
          label: "Build with revnets",
          description:
            "Turn these concepts into a launch configuration, a transaction map, and a product users can verify.",
        }}
      />
    </>
  );
}
