import { normalizeBendystrawEndpoint, selectBendystrawEndpoint } from "@bananapus/nana-sdk-core";

function graphqlEndpoint(value: string | undefined, fallback: string): string {
  return normalizeBendystrawEndpoint(value?.trim() || fallback);
}

const bendystrawUrl = graphqlEndpoint(
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL,
  "https://bendystraw.up.railway.app/graphql",
);
const testnetBendystrawUrl = graphqlEndpoint(
  process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL,
  "https://testnet.bendystraw.xyz/graphql",
);

export function getBendystrawUrl(chainId: number): string {
  return selectBendystrawEndpoint(
    { mainnet: bendystrawUrl, testnet: testnetBendystrawUrl },
    { chainId },
  );
}
