import {
  CHAIN_SLUGS,
  JUICEBOX_CENTER_API_URL,
  JUICEBOX_MCP_GUIDE_URL,
  JUICEBOX_MCP_URL,
  JUICEBOX_SKILLS_URL,
} from "@/lib/agent-guide";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

/**
 * llmstxt.org index: the URL grammar and JSON endpoints an agent needs to read this
 * site without scraping rendered markup or guessing route shapes.
 */
const LLMS_TXT = `# Revnet

> Tokenized incentives backed by a balance sheet, on a schedule fixed at launch.
> An operator can manage details but cannot change the schedule or withdraw the
> balance. This site runs revnets on Juicebox V6 across Ethereum, Base, Arbitrum,
> and Optimism, reading the contracts and Bendystraw, an index of their records.

## URL grammar

- \`/<chain>:<projectId>\`: a revnet by its chain-scoped id, e.g. \`/base:10\`.
  Chain slugs: ${CHAIN_SLUGS}.
- \`/@<handle>\`: the same revnet by its verified ENS handle. A handle is only served
  when ENS and the JBProjectHandles registry agree that the revnet's current operator
  claimed it, so it names exactly one revnet.
- Revnet subpages: \`/<slug>/owners\`, \`/<slug>/terms\`, \`/<slug>/shop\`, \`/<slug>/extras\`, \`/<slug>/operator\`.
- \`/account/<address-or-ens>\`: holdings and roles for one account. Not indexed.

Each revnet page carries schema.org Organization JSON-LD with its canonical URL,
identifier, description and logo.

## Pages

- [Home](${siteOrigin}/): how revnets work and where to start.
- [Discover](${siteOrigin}/discover): every indexed revnet.
- [Learn](${siteOrigin}/learn): what a revnet is and the rules it fixes at launch.
- [Build](${siteOrigin}/build): launch a revnet, connect an app, or write a contract.
- [Stages](${siteOrigin}/learn#stages): the schedule a revnet fixes at launch, with an example.
- [Loans](${siteOrigin}/learn#loans): borrowing against tokens, repaying, and the 10-year expiry.
- [Operator](${siteOrigin}/learn#operator): what the operator can and cannot do.
- [Launch form](${siteOrigin}/build#launch-without-code): launch a revnet without code.
- [deployFor, field by field](${siteOrigin}/build#install-and-deploy-from-solidity): launch from a contract.
- [Glossary](${siteOrigin}/learn#glossary): short definitions of the words used across this site.
- [Fees](${siteOrigin}/learn#fees): costs, receiving revnets, and how they share tokens with payers.
- [Payment tutorial (on juicebox.money)](https://juicebox.money/build/first-payment): read a project, preview a payment, then try it on a test network.
- [Model the schedule](${siteOrigin}/build#choosing-the-numbers): compare scenarios before preparing a revnet draft.
- [Three prices](${siteOrigin}/learn#three-prices): compare new tokens, existing tokens, and returning tokens for money.
- [Inspect a project](https://juicebox.center/#apps/juicescan): identify a project by its network and ID; check transaction confirmation and any destination claim.
- [Create](${siteOrigin}/create): the revnet launch flow.
- [Audit](${siteOrigin}/audit): source and review prompts.

## For agents

- [Agent skill](${siteOrigin}/skill.md): how to launch, check, pay, cash out, and borrow here.
- [Learn, as markdown](${siteOrigin}/learn.md): the whole Learn guide in one file.
- [Build, as markdown](${siteOrigin}/build.md): the whole Build guide in one file.
- [Juicebox MCP](${JUICEBOX_MCP_URL}): reads, quotes, metadata pinning, and unsigned
  transaction plans. Holds no keys; the user signs.
- [MCP guide](${JUICEBOX_MCP_GUIDE_URL}): how to connect a client.
- [Contract addresses](https://juicebox.center/api/v1/catalog/contracts): every V6 contract per chain, keyless JSON.
- [Juicebox Center API](${JUICEBOX_CENTER_API_URL}): RPC, IPFS, and indexed data in one place.
- [Juicebox V6 skills](${JUICEBOX_SKILLS_URL}): instructions for launching,
  paying, cashing out, loans, and integrations.
- [Launch with an AI assistant](${siteOrigin}/build#launch-with-an-agent): the MCP or a .jb draft.
- [Example .jb draft](${siteOrigin}/examples/revnet.jb): the three-stage schedule from Learn, on Base, which imports at
  ${siteOrigin}/create. \`issuance\` is tokens per ETH, and empty on a later stage picks up where the stage before ends.
  \`cutPercent\` (the issuance cut) and a split's \`share\` are 0 to 100, \`cashOutTax\` is 0 to 1, \`cutDays\` is days
  between cuts, and \`startAfterDays\` is days after the previous stage starts, rounded up to one of that stage's cuts.
  Only \`v\`, \`kind\` and \`stages\` are required, and a key the format does not name refuses the file. The form asks
  for the two blanks, the operator and the split recipient.
- [Shared app work](${siteOrigin}/build#shared-with-juicebox): SDK, reads, payments, and signing.
- [Audit prompts](${siteOrigin}/audit): review the whole system or one transaction.

## JSON endpoints

Read-only, no key required, cached at the edge. A revnet's stages are not in the page HTML;
read \`/api/stages\`, or use \`jb_get_revnet\` on the MCP.

- \`GET /api/discover-projects\`: every indexed V6 revnet, one entry per sucker group.
- \`GET /api/top-projects?limit=<1-32>&offset=<n>\`: revnets ranked by balance.
- \`GET /api/search-projects?q=<text>\`: revnets matching a name, handle or id.
- \`GET /api/project-name?chainId=<id>&projectId=<id>\`: canonical name and sucker group.
- \`GET /api/stages?chainId=<id>&projectId=<id>\`: a revnet's stages in order and the current one: issuance per unit paid, cuts, split, cash out tax, auto issuance. Its \`units\` field states each unit. 404 if the project is not a revnet.
- \`GET /api/homepage-activity\`: recent payments and cash outs.
- \`GET /api/project-og/<chainId>/<projectId>\`: 1200x630 PNG link-preview card.

## Source

- Revnet contracts: https://github.com/rev-net/revnet-core-v6
- Protocol contracts: https://github.com/Bananapus/version-6
- This client: https://github.com/mejango/revnet-money
`;

export const revalidate = 3600;

export function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
