import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({ projectId: 4n, contractAddress: () => CONTROLLER }),
  useJBProjectMetadataContext: () => ({ metadata: { data: { name: "Project" } } }),
  useJBTokenContext: () => ({ token: { data: { name: "Project token", symbol: "PROJ" } } }),
}));
vi.mock("@/hooks/useViewedAccount", () => ({
  useViewedAccount: () => ({ address: undefined }),
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EtherscanLink", () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => false,
  submittedViaSafe: () => false,
  requireOnchainExecution: vi.fn(),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: vi.fn(), reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: vi.fn() }),
  waitForRelayrBundle: vi.fn(),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, chainId: 1 }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: undefined, chainId: 1 }),
  getPublicClient: () => ({ readContract: () => new Promise(() => {}) }),
}));

import { V6TokenPanel } from "@/app/[slug]/components/v6/owners/V6TokenPanel";
import { installQueryPersistence, PERSIST, serializeState } from "@/lib/query-persist";

const ACCOUNT = `0x${"11".repeat(20)}`;
const CONTROLLER = `0x${"22".repeat(20)}`;
const TOKEN = `0x${"33".repeat(20)}`;

it.each([true, false])(
  "hydrates with persisted token state restored before the panel mounts (deployed: %s)",
  async (deployed) => {
    const server = new QueryClient();
    const client = new QueryClient();
    const previous = new QueryClient();
    const key = ["v6-token-panel", "1:4"];
    const projects = [{ chainId: 1, projectId: 4, token: TOKEN }] as React.ComponentProps<
      typeof V6TokenPanel
    >["projects"];
    previous.setQueryDefaults(key, { meta: PERSIST });
    previous.setQueryData(key, [
      {
        chainId: 1,
        projectId: 4n,
        controller: CONTROLLER,
        owner: ACCOUNT,
        token: deployed ? TOKEN : null,
        name: deployed ? "Previously read token" : null,
        symbol: deployed ? "OLD" : null,
      },
    ]);
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    storage.setItem("revnet:query-cache:v1", serializeState(dehydrate(previous)));
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <QueryClientProvider client={server}>
        <V6TokenPanel projects={projects} />
      </QueryClientProvider>,
    );
    document.body.append(container);
    expect(container.textContent).toBe("Token");
    expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
    const teardown = installQueryPersistence(client, storage);
    expect(client.getQueryData(key)).toEqual(previous.getQueryData(key));
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <QueryClientProvider client={client}>
            <V6TokenPanel projects={projects} />
          </QueryClientProvider>,
          { onRecoverableError: (error) => recoverableErrors.push(error) },
        );
      });
      expect(recoverableErrors).toEqual([]);
      expect(container.textContent).toContain(deployed ? "Previously read token" : "No ERC-20 yet");
      expect(container.querySelector(".skeleton-shimmer")).toBeNull();
      expect(container.querySelector("button")).toHaveTextContent(
        deployed ? "Edit" : "Deploy ERC-20",
      );
    } finally {
      await act(async () => root?.unmount());
      teardown();
      server.clear();
      client.clear();
      previous.clear();
      container.remove();
    }
  },
);
