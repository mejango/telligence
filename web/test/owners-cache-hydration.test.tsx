import { AmmCard } from "@/app/[slug]/components/v6/owners/market/AmmCard";
import type { AmmChainState } from "@/app/[slug]/components/v6/owners/market/lib";
import { MarketPriceChart } from "@/app/[slug]/components/v6/owners/market/MarketPriceChart";
import { SplitHookCard } from "@/app/[slug]/components/v6/owners/market/SplitHookCard";
import { V6MarketSubtab } from "@/app/[slug]/components/v6/owners/market/V6MarketSubtab";
import { AcrossChainsCard } from "@/app/[slug]/components/v6/owners/settlement/AcrossChainsCard";
import { BridgesCard } from "@/app/[slug]/components/v6/owners/settlement/BridgesCard";
import { GossipCard } from "@/app/[slug]/components/v6/owners/settlement/GossipCard";
import {
  chainProjectsKey,
  type ChainProject,
} from "@/app/[slug]/components/v6/owners/settlement/lib";
import { QueuedMovementsCard } from "@/app/[slug]/components/v6/owners/settlement/QueuedMovementsCard";
import { V6SettlementSubtab } from "@/app/[slug]/components/v6/owners/settlement/V6SettlementSubtab";
import type { ProjectItem } from "@/app/[slug]/components/v6/shared";
import { installQueryPersistence, PERSIST, serializeState } from "@/lib/query-persist";
import type { V6BridgeRow } from "@/lib/v6/suckerProofs";
import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (original) => ({
  ...(await original<object>()),
  fetchAmmStates: () => new Promise(() => {}),
  fetchSplitHookStates: () => new Promise(() => {}),
}));
vi.mock("@/app/[slug]/components/v6/owners/settlement/lib", async (original) => ({
  ...(await original<object>()),
  fetchBridges: () => new Promise(() => {}),
  fetchAcrossChains: () => new Promise(() => {}),
  fetchGossip: () => new Promise(() => {}),
  projectTokenSymbol: () => new Promise(() => {}),
}));

vi.mock("@/lib/v6/suckerProofs", async (original) => ({
  ...(await original<object>()),
  fetchV6BridgeRows: () => new Promise(() => {}),
}));
// These children do not own persisted display state and require wallet providers.
vi.mock("@/app/[slug]/components/v6/owners/settlement/PayoutsCard", () => ({
  PayoutsCard: () => null,
}));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));

const chains: ChainProject[] = [
  { chainId: 1, projectId: 1n },
  { chainId: 8453, projectId: 1n },
];
const chainKey = chainProjectsKey(chains);
const noPools: AmmChainState[] = chains.map(({ chainId, projectId }) => ({
  chainId,
  projectId,
  hook: null,
  pool: null,
  composition: null,
  reference: { issuance: null, cashOut: null },
}));

const projects: ProjectItem[] = chains.map(({ chainId, projectId }) => ({
  chainId,
  projectId: Number(projectId),
  token: null,
  currency: 1,
  decimals: 18,
  tokenSymbol: "REV",
}));
const unreadableAcrossChains = chains.map(({ chainId }) => ({
  chainId,
  supply: null,
  balances: null,
  unitValue: null,
}));
const neverSynced = chains.map(({ chainId }) => ({
  chainId,
  peers: chains
    .filter((chain) => chain.chainId !== chainId)
    .map(({ chainId: peerChainId }) => ({
      peerChainId,
      supply: 0n,
      balances: [],
      snapshot: 0,
      level: "never",
      label: "Never synced",
      syncSucker: null,
    })),
}));
const pendingMovement: V6BridgeRow & { tokenSymbol: string } = {
  chainId: 1,
  projectId: 1n,
  peerChainId: 8453,
  beneficiary: "0x1111111111111111111111111111111111111111",
  beneficiary32: `0x${"00".repeat(32)}`,
  projectTokenCount: 10n ** 18n,
  terminalTokenAmount: 10n ** 15n,
  status: "pending",
  index: 0,
  sourceSucker: "0x3333333333333333333333333333333333333333",
  peerSucker: "0x4444444444444444444444444444444444444444",
  metadata: "0x",
  proof: null,
  canExecute: false,
  token: "0x000000000000000000000000000000000000eeee",
  remoteToken: "0x000000000000000000000000000000000000eeee",
  tokenDecimals: 18,
  tokenSymbol: "ETH",
  infra: "native",
};

type HydrationCase = {
  name: string;
  key: unknown[];
  data: unknown;
  component: ReactNode;
  content: string;
  keepsSkeletons?: boolean;
  beforeText?: string;
};

const cases: HydrationCase[] = [
  {
    name: "empty market chart",
    key: ["v6AmmStates", chainKey],
    data: noPools,
    component: <MarketPriceChart chains={chains} tokenSymbol="REV" />,
    content: "",
  },
  {
    name: "empty market pools",
    key: ["v6AmmStates", chainKey],
    data: noPools,
    component: <AmmCard chains={chains} tokenSymbol="REV" />,
    content: "No buyback hook is configured",
  },
  {
    name: "empty bridges",
    key: ["v6Bridges", chainKey],
    data: [],
    component: <BridgesCard chains={chains} tokenSymbol="REV" />,
    content: "",
  },
  {
    name: "restored native bridge",
    key: ["v6Bridges", chainKey],
    data: [{ a: 1, b: 8453, infra: "native" }],
    component: <BridgesCard chains={chains} tokenSymbol="REV" />,
    content: "native",
  },
  {
    name: "empty split hook",
    key: ["v6SplitHookStates", chainKey],
    data: [],
    component: <SplitHookCard chains={chains} tokenSymbol="REV" />,
    content: "",
  },
  {
    name: "unreadable cross-chain rows",
    key: ["v6AcrossChains", chainKey],
    data: unreadableAcrossChains,
    component: <AcrossChainsCard chains={chains} tokenSymbol="REV" />,
    content: "Supply (REV)",
  },
  {
    name: "never-synced gossip",
    key: ["v6Gossip", chainKey],
    data: neverSynced,
    component: <GossipCard chains={chains} />,
    content: "Never synced",
  },
  {
    name: "empty queued movements",
    key: ["v6BridgeRows", chainKey],
    data: [],
    component: <QueuedMovementsCard chains={chains} tokenSymbol="REV" />,
    content: "No queued movements.",
  },
  {
    name: "queued movement counts",
    key: ["v6BridgeRows", chainKey],
    data: [pendingMovement],
    component: <QueuedMovementsCard chains={chains} tokenSymbol="REV" />,
    content: "Pending (1)",
  },
  {
    name: "market ticker",
    key: ["v6ProjectTokenSymbol", chainKey],
    data: "REV",
    component: <V6MarketSubtab projects={projects} />,
    content: "existing REV",
    beforeText: "existing tokens",
    keepsSkeletons: true,
  },
  {
    name: "settlement ticker",
    key: ["v6ProjectTokenSymbol", chainKey],
    data: "REV",
    component: <V6SettlementSubtab projects={projects} />,
    content: "REV, funds",
    beforeText: "tokens, funds",
    keepsSkeletons: true,
  },
];

it.each(cases)(
  "hydrates $name without regenerating its boundary",
  async ({ key, data, component, content, keepsSkeletons, beforeText }) => {
    const server = new QueryClient();
    const client = new QueryClient();
    const previous = new QueryClient();
    previous.setQueryDefaults(key, { meta: PERSIST });
    previous.setQueryData(key, data);
    const storageKey = "revnet:query-cache:v1";
    const oldStore = window.localStorage.getItem(storageKey);
    window.localStorage.setItem(storageKey, serializeState(dehydrate(previous)));
    const tree = (queryClient: QueryClient) => (
      <QueryClientProvider client={queryClient}>
        <Suspense>
          <span data-hydration-marker />
          {component}
        </Suspense>
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree(server));
    document.body.append(container);
    expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
    if (beforeText) expect(container).toHaveTextContent(beforeText);
    const marker = container.querySelector("[data-hydration-marker]");
    const stop = installQueryPersistence(client, window.localStorage);
    expect(client.getQueryData(key)).toEqual(data);
    const errors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree(client), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(errors).toEqual([]);
      expect(container.querySelector("[data-hydration-marker]")).toBe(marker);
      if (!keepsSkeletons) expect(container.querySelector(".skeleton-shimmer")).toBeNull();
      if (content) expect(container).toHaveTextContent(content);
      else expect(container.textContent).toBe("");
      expect(client.getQueryData(key)).toEqual(data);
    } finally {
      await act(async () => root?.unmount());
      stop();
      server.clear();
      client.clear();
      previous.clear();
      container.remove();
      if (oldStore === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, oldStore);
    }
  },
);
