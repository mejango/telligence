import { V6SplitsSubtab } from "@/app/[slug]/components/v6/owners/V6SplitsSubtab";
import type { ProjectItem } from "@/app/[slug]/components/v6/shared";
import type { RawRuleset } from "@/lib/nana/rulesets";
import { installQueryPersistence, PERSIST, serializeState } from "@/lib/query-persist";
import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { zeroAddress } from "viem";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({ projectId: 1n, contractAddress: () => zeroAddress }),
  useJBChainId: () => 1,
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
}));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectPermissions: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/app/[slug]/owners/components/DistributeReservedTokensButton", () => ({
  DistributeReservedTokensButton: () => null,
}));
vi.mock("@/app/[slug]/owners/components/ChangeSplitRecipientsDialog", () => ({
  ChangeSplitRecipientsDialog: () => null,
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi/actions", () => ({
  getPublicClient: () => ({ readContract: () => new Promise(() => {}) }),
}));
vi.mock("wagmi", () => ({
  useReadContracts: ({ contracts }: { contracts: Array<{ functionName: string }> }) => ({
    data: contracts.map(({ functionName }) => ({
      status: "success",
      result: functionName === "splitsOf" ? [] : zeroAddress,
    })),
    isLoading: false,
  }),
}));

const projects = [{ chainId: 1, projectId: 1, token: null }] as ProjectItem[];
const ruleset: RawRuleset = {
  cycleNumber: 1,
  id: 1_700_000_000,
  basedOnId: 0,
  start: 1_700_000_000,
  duration: 0,
  weight: 1n,
  weightCutPercent: 0,
  approvalHook: zeroAddress,
  metadata: 250n << 4n,
};

it.each([false, true])(
  "hydrates Splits after persisted rulesets restore before the subtab mounts (has stages: %s)",
  async (hasStages) => {
    const restoredRulesets = hasStages ? [ruleset] : [];
    const server = new QueryClient();
    const client = new QueryClient();
    const previous = new QueryClient();
    const key = ["all-rulesets", 1, "1", zeroAddress];
    const storageKey = "revnet:query-cache:v1";
    const previousCache = window.localStorage.getItem(storageKey);
    previous.setQueryDefaults(key, { meta: PERSIST });
    previous.setQueryData(key, restoredRulesets);
    window.localStorage.setItem(storageKey, serializeState(dehydrate(previous)));

    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <QueryClientProvider client={server}>
        <V6SplitsSubtab projects={projects} />
      </QueryClientProvider>,
    );
    document.body.append(container);
    expect(container.querySelector('[aria-label="Loading table"]')).not.toBeNull();
    const teardown = installQueryPersistence(client, window.localStorage);
    expect(client.getQueryData(key)).toEqual(previous.getQueryData(key));
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <QueryClientProvider client={client}>
            <V6SplitsSubtab projects={projects} />
          </QueryClientProvider>,
          { onRecoverableError: (error) => recoverableErrors.push(error) },
        );
      });
      expect(recoverableErrors).toEqual([]);
      expect(container.querySelector('[aria-label="Loading table"]')).toBeNull();
      expect(container.textContent).toContain(
        restoredRulesets.length ? "No splits on this chain." : "This chain has no stage 1.",
      );
    } finally {
      await act(async () => root?.unmount());
      teardown();
      server.clear();
      client.clear();
      previous.clear();
      container.remove();
      if (previousCache === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, previousCache);
    }
  },
);
