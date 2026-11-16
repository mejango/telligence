import type { RevnetGuideContent, RevnetGuideSection } from "@/components/guides/RevnetGuide";

const GLOSSARY = (
  [
    [
      "Incentives",
      "what a revnet gives people who pay in or contribute. Here, incentives are tokens.",
    ],
    ["Token", "a unit recorded for its owner and counted in the revnet's supply."],
    ["Balance sheet / balance", "the money a revnet holds for its owners."],
    [
      "Backing",
      "the balance sheet divided by the token supply. Loans and other chains count too, so it can differ from what one chain pays out right now.",
    ],
    ["Supply", "the total number of tokens, including tokens behind open loans."],
    [
      "Chain",
      "a blockchain network, such as Ethereum or Base. Each keeps its own records and balances.",
    ],
    ["Issuance", "creating new tokens, also called minting."],
    ["Issuance cut", "a scheduled drop in how many tokens a payment creates."],
    ["Burn", "destroying tokens. Cash outs burn tokens; loans burn collateral until it's repaid."],
    ["Split", "the share of new tokens that goes to contributors instead of the payer."],
    [
      "Auto issuance",
      "a fixed number of tokens set aside at launch, claimable once its stage starts.",
    ],
    ["Stage", "one period in a revnet's schedule, with its own issuance, split, and cash out tax."],
    [
      "Floor / ceiling",
      "the cash out price and the issuance price, the band the market trades between.",
    ],
    ["Cash out", "return tokens for a share of the balance sheet."],
    ["Cash out tax", "how much of a cash out stays behind for remaining owners."],
    [
      "Pool / liquidity",
      "a shared market holding tokens and money for trades, and the amount available to trade.",
    ],
    [
      "Slippage / minimum",
      "the gap between a quote and the result, and the least you agree to receive.",
    ],
    [
      "Collateral",
      "tokens you borrow against. They're burned while the loan is open and minted back when you repay.",
    ],
    [
      "Loan NFT",
      "the transferable record of a loan. Whoever holds it can repay and recover the collateral.",
    ],
    ["Liquidation", "closing an expired loan. A falling price never liquidates a revnet loan."],
    [
      "Operator",
      "the person or contract that manages a revnet's details. It can't change the schedule or withdraw from the balance sheet.",
    ],
    ["Bridge", "a way to move tokens between chains."],
    ["Gas", "the network cost of processing a transaction, usually paid in ETH."],
    [
      "Approval",
      "permission for a contract to spend a set amount of your token. It's a separate step before paying with a token like USDC.",
    ],
  ] as const
).toSorted(([a], [b]) => a.localeCompare(b));

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "what-is-a-revnet",
    aliases: ["start-here"],
    part: "The basics",
    title: "What a revnet is",
    summary: "Tokenized incentives backed by a balance sheet, on a schedule fixed at launch.",
    paragraphs: [
      "Customers and supporters pay the revnet. Each payment adds to its balance sheet and gives the payer tokens, either newly created or bought from a [market](#markets-and-buybacks) when that gets them more. Part of every new batch goes to contributors through the revnet's splits.",
      "Owners can cash out, returning tokens for a share of the balance sheet, or [borrow](#loans) against their tokens. No team, founder, or [operator](#operator) can withdraw from it.",
      "An operator can manage day-to-day details: the name, contributor addresses, the shop, and market settings. The operator can't change the schedule or withdraw from the balance sheet.",
    ],
    links: [
      { href: "/discover", label: "Explore live revnets" },
      { href: "/build#when-to-use-a-revnet", label: "Decide whether a revnet fits your product" },
      { href: "#glossary", label: "Look up a term" },
    ],
  },
  {
    id: "how-money-flows",
    part: "The basics",
    title: "How money flows",
    summary:
      "People pay in, then cash out their tokens for money or [borrow](#loans) against them.",
    diagramsFirst: true,
    diagrams: [
      {
        label: "The loop",
        description:
          "A payment creates tokens and funds the balance sheet, or buys existing tokens from a market. Some tokens go to contributors. Cashing out burns the returned tokens. Borrowing burns the tokens used to secure the loan until it is repaid.",
        lines: [
          "1. Someone PAYS the revnet",
          " └─▶ create tokens for the payer",
          "     and contributors",
          " └─▶ money used to create tokens",
          "     enters the balance",
          " └─▶ or the money buys existing",
          "     tokens from a market",
          "",
          "2. Owners CASH OUT",
          " └─▶ return tokens for money;",
          "     those tokens are burned",
          " └─▶ the rules decide how much",
          "     stays for other owners",
          "",
          "3. Or owners BORROW against tokens",
          "   instead of cashing out",
        ],
      },
    ],
    paragraphs: [
      "Divide the balance sheet by the token supply and you get each token's backing. Loans and balances on other chains count too, so backing can be higher than what one chain can pay out right now.",
      "Payments add money and tokens together. [Splits and auto issuance](#splits-and-auto-issuance) add tokens without money. Cash outs remove both, and the [cash out tax](#cash-out-tax) leaves part of the money behind for everyone who stays.",
      "Contributors are paid in tokens. To turn them into ETH or USDC they cash out, borrow, or sell, on the same terms as everyone else. There's no separate team budget.",
    ],
  },
  {
    id: "three-prices",
    part: "The basics",
    title: "The three prices",
    summary:
      "You can buy new tokens from the revnet, return tokens to it, or trade existing tokens with other people. Each has its own price.",
    points: [
      {
        key: "Issuance price",
        text: "what a new token costs from the revnet. It goes up each time issuance is cut. Once a [stage](#stages) stops issuance, there isn't one.",
      },
      {
        key: "Cash out price",
        text: "what the revnet pays per token you return. It depends on the balance sheet, the supply, the [cash out tax](#cash-out-tax), and how many you return.",
      },
      {
        key: "Market price",
        text: "what other people pay. It moves with every trade.",
      },
    ],
    paragraphs: [
      "The issuance price is a ceiling: why pay a [market](#markets-and-buybacks) more when the revnet sells new tokens for less? The cash out price is a floor: why sell for less when the revnet pays more? The market trades between them. Fees and thin pools can push a trade outside that band, so check the final quote.",
    ],
  },
  {
    id: "stages",
    part: "The basics",
    title: "Stages",
    summary:
      "A revnet's rules change in stages, on a schedule fixed at launch. The whole schedule is public from day one.",
    paragraphs: [
      "Like Bitcoin's halvings, issuance cuts are scheduled in advance. Earlier supporters get more tokens for the same money, and everyone can see when the next cut lands.",
    ],
    diagrams: [
      {
        label: "Example schedule",
        description:
          "Illustrative schedule: stage one starts on day zero, issues 1,000 tokens per ETH before a 30% split, cuts issuance by 10% every 30 days, and has a cash out tax of 0.2. Stage two starts on day 365, inherits the rate, cuts it by 5% every 90 days, and uses a 10% split and a tax of 0.5. Stage three starts on day 1,825 with no new issuance and a tax of 0.5.",
        lines: [
          "STAGE 1  day 0",
          "  1,000 tokens per ETH",
          "  cut 10% every 30 days",
          "  split 30% to contributors",
          "  cash out tax 0.2",
          "",
          "STAGE 2  day 365",
          "  rate carries over",
          "  cut 5% every 90 days",
          "  split 10%, cash out tax 0.5",
          "",
          "STAGE 3  day 1,825",
          "  issuance stops",
          "  split 0%, cash out tax 0.5,",
          "  forever",
        ],
      },
    ],
    points: [
      { key: "Start", text: "when the stage begins." },
      { key: "Issuance", text: "new tokens per ETH or USD paid." },
      { key: "Issuance cut", text: "how much issuance drops, and how often." },
      {
        key: "Splits",
        text: "the share of new tokens that goes to contributors instead of the payer.",
      },
      {
        key: "Cash out tax",
        text: "how much of a cash out stays behind for remaining owners.",
      },
      {
        key: "Auto issuance",
        text: "a fixed number of tokens a recipient can claim once the stage starts.",
      },
    ],
    note: "Later stages apply to the tokens you hold today, so read the whole schedule.",
  },
  {
    id: "operator",
    part: "The basics",
    title: "The operator",
    summary:
      "Every revnet is owned by a contract that enforces its schedule. A person or another contract can hold the operator role, to handle the details that need a human.",
    points: [
      {
        key: "Can",
        text: "rename the revnet and edit its description; change split recipients; choose its [market](#markets-and-buybacks) and payment routes; manage bridges, and add chains if the launch allowed it. With a shop, the operator can also add items, set discounts, edit details, and mint copies.",
      },
      {
        key: "Can't",
        text: "change issuance, cuts, cash out taxes, split percentages, or stage timing, or withdraw from the balance sheet.",
      },
      {
        key: "Can hand over",
        text: "the role to someone else, or to nobody. Handing it to nobody is permanent.",
      },
    ],
    note: "The operator's choices about recipients, markets, and the shop still affect owners, so check who holds the role on each chain.",
  },
  {
    id: "your-first-transaction",
    aliases: ["verify-before-trusting"],
    part: "The basics",
    title: "Your first transaction",
    summary: "Pick a revnet, read its terms, and review the payment before you sign.",
    points: [
      {
        key: "1. Choose a revnet",
        text: "Open Discover and pick one. In Terms, read every [stage](#stages), who receives splits, which assets it accepts, and what the [operator](#operator) can do.",
      },
      {
        key: "2. Choose the chain and amount",
        text: "Pay with an accepted asset on that chain, and keep some ETH for gas.",
      },
      {
        key: "3. Review what you'll receive",
        text: "Check your tokens, the split, the route, and the minimum you'll accept. Paying with a token like USDC needs an approval first, a separate step that lets the revnet spend it. Make sure your wallet shows what you reviewed.",
      },
      {
        key: "4. Wait for confirmation",
        text: "Keep the transaction link. A Safe proposal does nothing until it's executed.",
      },
      {
        key: "5. Next steps",
        text: "From your holdings you can quote a cash out or a loan. A zero quote usually means the balance on that chain is empty, or the revnet is still in a waiting period after launch.",
      },
    ],
    links: [
      { href: "/discover", label: "Find a revnet to explore" },
      { href: "/audit", label: "Review contract and website audits" },
      {
        href: "https://juicebox.money/build/first-payment#pay",
        label: "Try a payment on a test network",
      },
    ],
  },
  {
    id: "cash-out-tax",
    part: "Going deeper",
    title: "Cash outs and the cash out tax",
    summary:
      "When you cash out, you return tokens to the revnet and receive a share of its balance sheet. The returned tokens are burned. The cash out tax leaves part of your share behind for everyone who stays.",
    paragraphs: [
      "Return 10% of the supply at a tax of 0 and you get 10% of the balance sheet. Raise the tax and you get less, though not as much less as the rate suggests, because the formula also weighs how much of the supply you return.",
      "Bigger cash outs get more per token. Splitting one cash out into several smaller ones returns less in total, and costs more gas. The tax is set per [stage](#stages), so later stages can leave more or less behind. Fees, loans, and [market](#markets-and-buybacks) routes change the final amount, so check the quote.",
    ],
    steps: [
      "Open the revnet on the chain where you hold the tokens.",
      "In the You card, choose Cash out, enter an amount, and check what you'll receive and the minimum you'll accept.",
      "Approve in your wallet and wait for confirmation.",
    ],
    compare: {
      label: "Worked example before fees",
      lead: "Balance 100 ETH, you hold 10% of the supply",
      columns: ["Tax", "Cash out returns", "Stays"],
      rows: [
        ["0", "10.0 ETH", "0 ETH"],
        ["0.2", "8.2 ETH", "1.8 ETH"],
        ["0.5", "5.5 ETH", "4.5 ETH"],
        ["0.8", "2.8 ETH", "7.2 ETH"],
      ],
      footer: "returned = balance × share × ((1 − tax) + tax × share). Use 0.1 for a 10% share.",
    },
    links: [
      { href: "https://juicebox.money/build#apps-cash-out", label: "How an app quotes cash outs" },
      { href: "#fees", label: "Costs and where they go" },
    ],
  },
  {
    id: "splits-and-auto-issuance",
    part: "Going deeper",
    title: "Splits: tokens for contributors",
    summary:
      "A revnet's split sends part of every new batch of tokens to contributors, partners, or other revnets.",
    paragraphs: [
      "With a 30% split, a payment that creates 1,000 tokens gives 700 to the payer and 300 to the split recipients. Recipients get tokens, never money from the balance sheet.",
      "Each [stage](#stages)'s split percentage is fixed at launch. The [operator](#operator) can change who receives it, unless a recipient is locked, but never how much. Recipients can differ by chain; the percentage can't.",
      "Auto issuance is separate: a fixed number of tokens set aside at launch for named recipients, claimable once its stage starts. It adds tokens without adding money, so count any unclaimed auto issuance when you size up your share of the supply.",
    ],
  },
  {
    id: "markets-and-buybacks",
    part: "Going deeper",
    title: "Markets and buybacks",
    summary:
      "People can deposit tokens and money into a shared liquidity pool for others to trade against. When you pay a revnet, it checks that pool and buys existing tokens for you when they're cheaper than new ones.",
    paragraphs: [
      "Money spent in the pool goes to the sellers, not into the balance sheet. Tokens bought this way go to you whole; only newly created tokens pay the split. You can also trade on the pool directly, which skips the split. Shop items have to be bought through a payment.",
      "Cash outs work the same way in reverse: if selling to the pool pays more, the cash out sells there, and the review shows which route it takes.",
    ],
    note: "A pool can be empty or too thin for your amount. Set a minimum you'll accept; the transaction fails rather than paying you less.",
  },
  {
    id: "loans",
    part: "Going deeper",
    title: "Loans",
    summary:
      "Borrow against your tokens and get them back when you repay. The tokens you put up as collateral are burned while the loan is open.",
    diagramsFirst: true,
    diagrams: [
      {
        label: "Loan lifecycle",
        description:
          "Borrowing burns the collateral tokens and sends you money after costs. You receive a transferable loan NFT. Repay the debt, plus any time-based fee, before the 10-year expiry to get your tokens back. After expiry the collateral stays burned.",
        lines: [
          "borrow",
          " └─▶ your tokens are burned as",
          "     collateral",
          " └─▶ the revnet sends you funds,",
          "     minus fees",
          " └─▶ you receive a loan NFT as",
          "     your receipt",
          "",
          "repay (before the 10-year expiry)",
          " └─▶ return the debt plus any",
          "     time-based fee",
          " └─▶ your collateral tokens are",
          "     minted back to you",
          "",
          "expiry (after 10 years)",
          " └─▶ the loan is written off,",
          "     collateral stays burned",
        ],
      },
    ],
    paragraphs: [
      "How much you can borrow follows the cash out price: the same balance sheet and [cash out tax](#cash-out-tax), capped by what's available on your chain. A loan is no way around a high cash out tax.",
      "Borrowing costs come out up front, so you receive less than you owe. Repay the debt, plus a time-based fee if you take longer than you prepaid, and your tokens are minted back to you. Open loans still count in the balance sheet and the supply until they're repaid or expire.",
      "A falling price never liquidates a loan. After 10 years an unpaid loan expires and the collateral stays burned. The loan itself is an NFT: whoever holds it can repay it and recover the tokens.",
    ],
    steps: [
      "Open the revnet on the chain where you hold the tokens.",
      "In the You card, choose Get a loan, enter an amount, and check what you'll receive and the minimum borrowed.",
      "Approve in your wallet and wait for confirmation.",
    ],
    links: [
      { href: "#fees", label: "Borrowing costs and where they go" },
      { href: "/build#operate-loans", label: "Integrate loan quotes and repayment" },
    ],
  },
  {
    id: "fees",
    part: "Going deeper",
    title: "Fees and where they go",
    summary:
      "Two small protocol fees apply when money leaves a revnet. Each fee is a payment into another revnet, so the person paying it receives that revnet's tokens.",
    paragraphs: [
      "One fee goes to the Juicebox Protocol revnet (JBP6), the other to the Revnet Network revnet (REV). Paying into a revnet has no protocol fee.",
    ],
    points: [
      { key: "Launch", text: "a creation fee on each chain, up to 0.001 ETH." },
      {
        key: "Cash outs",
        text: "with a [cash out tax](#cash-out-tax) above 0, 2.5% of the money you receive goes to JBP6. REV receives a fee worth 2.5% of the tokens you return.",
      },
      {
        key: "Loans",
        text: "2.5% to JBP6, 1% to REV, and a prepaid borrowing cost of 2.5% to 50% that goes to the revnet you [borrow](#loans) from.",
      },
      {
        key: "Time to repay",
        text: "the prepaid cost buys time with no extra charge. 2.5% covers about 6 months; 50% covers the full 10 years. After that, the cost rises until expiry.",
      },
    ],
    note: "Check the quote for exact amounts.",
    links: [
      { href: "/eth:1#project-top", label: "Juicebox Protocol revnet" },
      { href: "/eth:3#project-top", label: "Revnet Network revnet" },
    ],
  },
  {
    id: "shops",
    part: "Going deeper",
    title: "Shops",
    summary:
      "A revnet can sell items through a shop. Buying one gives you the item, recorded as an NFT, plus the revnet's tokens.",
    paragraphs: [
      "Items have prices, limited copies, categories, and discounts. Some send part of the payment to another recipient, which the purchase breakdown shows. The [operator](#operator) may be able to add items or mint copies.",
      "The NFT records your purchase onchain. Anything physical, like delivery or access, depends on the seller, so read the item description.",
    ],
  },
  {
    id: "multichain",
    part: "Under the hood",
    title: "One revnet, many chains",
    summary:
      "A revnet can run on several chains at once, such as Ethereum and Base. Each chain holds its own balance and tokens, on the same schedule.",
    paragraphs: [
      "Payments and cash outs happen on the chain you pick. Quotes can count balances on every chain, but you can only withdraw what's on yours.",
      "Moving tokens between chains takes three steps: send from one chain, wait for the bridge, then claim on the other. Your tokens carry their share of the balance with them, with no [cash out tax](#cash-out-tax). Keep the transaction link until you've claimed; a confirmed send doesn't mean the tokens have arrived.",
    ],
  },
  {
    id: "built-on-juicebox",
    part: "Under the hood",
    title: "Built on Juicebox",
    summary:
      "Revnets run on Juicebox, an open protocol for collecting money, issuing tokens, and setting rules for funds. A revnet is a Juicebox project owned by a contract that locks in its schedule.",
    paragraphs: [
      "Juicebox handles payments, tokens, splits, cash outs, and moving between chains. Revnet adds the fixed schedule, loans, and the [operator](#operator)'s limited role.",
    ],
    links: [{ href: "https://juicebox.money/learn", label: "Learn Juicebox" }],
  },
  {
    id: "glossary",
    part: "Reference",
    title: "Glossary",
    summary: "Words you'll see on revnet pages.",
    table: {
      label: "Glossary",
      termIds: true,
      rows: GLOSSARY,
    },
    links: [
      { href: "#fees", label: "Fees and where they go" },
      { href: "/discover", label: "Explore live revnets" },
      { href: "/create", label: "Launch a revnet" },
      { href: "/audit", label: "Review audits" },
    ],
  },
];

/** The Learn guide's content: the page and /learn.md both render this. */
export const LEARN_GUIDE: RevnetGuideContent = {
  title: "How a revnet works",
  introduction:
    "Understand where your money goes, what tokens let you do, and which rules are fixed at launch.",
  sections: SECTIONS,
  companion: {
    href: "/build",
    label: "Build with revnets",
    description: "Choose your rules, launch a revnet, or connect an app.",
  },
};
