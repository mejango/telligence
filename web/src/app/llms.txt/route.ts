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
const LLMS_TXT = `# Telligence

> Fund the compute behind work you believe in. A creator describes work that needs AI
> inference, supporters fund its revnet in VVV on Base, and the creator uses a project
> API key while verified daily credit is available. Each project is a revnet on Juicebox V6
> with a policy wrapper and a vault that holds its compute backing.

## What to know before acting

- Base only (chain id 8453). Contributions are in VVV.
- A project's production split is a share of tokens issued, not a share of money contributed.
- Compute backing is not part of the balance holders can cash out at once. Unwinding it follows
  Venice's cooldowns and the vault's recovery policy.
- Inference depends on Venice. Daily credit resets at 00:00 UTC and does not roll over.
- The contracts have not been audited.

## URL grammar

- \`/compute/<id>\`: a compute project: its purpose, verified capacity, and funding.
- \`/compute/<id>/keys\`: the creator's API keys. Signed-in creator only.
- \`/base:<projectId>\`: the project's revnet, e.g. \`/base:10\`. Other chains answer 404.
- \`/@<handle>\`: the same revnet by its verified ENS handle.
- Revnet subpages: \`/<slug>/owners\`, \`/<slug>/terms\`, \`/<slug>/shop\`, \`/<slug>/extras\`, \`/<slug>/operator\`.
- \`/account/<address-or-ens>\`: holdings and roles for one account. Not indexed.

Chain slugs and ids across Juicebox V6: ${CHAIN_SLUGS}.

## Pages

- [Home](${siteOrigin}/): what Telligence is.
- [Discover](${siteOrigin}/discover): compute projects and their verified capacity.
- [How it works](${siteOrigin}/how-it-works): where a contribution goes, capacity, keys, and the way out.
- [Create](${siteOrigin}/create): describe a project, review its fixed terms, and launch it.
- [Recover](${siteOrigin}/recover): pause allocation and start a project's wind-down from its recovery wallet.

## Revnet guides

Written for revnets in general. Their launch steps describe revnet.money, not this site's Create page.

- [Learn](${siteOrigin}/learn): what a revnet is and the rules it fixes at launch.
- [Stages](${siteOrigin}/learn#stages): the schedule a revnet fixes at launch.
- [Fees](${siteOrigin}/learn#fees): costs and where they go.
- [Glossary](${siteOrigin}/learn#glossary): the words used on revnet pages.
- [Build](${siteOrigin}/build): connect an app or write a contract.
- [Audit](${siteOrigin}/audit): source and review prompts.
- [Learn, as markdown](${siteOrigin}/learn.md) and [Build, as markdown](${siteOrigin}/build.md).

## For agents

- [Agent skill](${siteOrigin}/skill.md): how to check a project and help someone act on it.
- [Juicebox MCP](${JUICEBOX_MCP_URL}): reads, quotes, and unsigned transaction plans for the
  revnet underneath a project. Holds no keys; the user signs.
- [MCP guide](${JUICEBOX_MCP_GUIDE_URL}): how to connect a client.
- [Contract addresses](https://juicebox.center/api/v1/catalog/contracts): every V6 contract per chain, keyless JSON.
- [Juicebox Center API](${JUICEBOX_CENTER_API_URL}): RPC, IPFS, and indexed data in one place.
- [Juicebox V6 skills](${JUICEBOX_SKILLS_URL}): instructions for paying, cashing out, loans, and integrations.

## JSON endpoints

Read-only, no key required, cached at the edge. A revnet's stages are not in the page HTML;
read \`/api/stages\`, or use \`jb_get_revnet\` on the MCP.

- \`GET /api/project-name?chainId=<id>&projectId=<id>\`: canonical name.
- \`GET /api/stages?chainId=<id>&projectId=<id>\`: a revnet's stages in order and the current one: issuance per unit paid, cuts, split, cash out tax, auto issuance. Its \`units\` field states each unit. 404 if the project is not a revnet.
- \`GET /api/search-projects?q=<text>\`: revnets matching a name, handle or id.
- \`GET /api/project-og/8453/<projectId>\`: 1200x630 PNG link-preview card.

## Source

- Telligence: https://github.com/mejango/telligence
- Revnet contracts: https://github.com/rev-net/revnet-core-v6
- Protocol contracts: https://github.com/Bananapus/version-6
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
