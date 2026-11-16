import { Header } from "@/app/[slug]/components/Header/Header";
import { TvlDatum } from "@/app/[slug]/components/Header/TvlDatum";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installQueryPersistence, PERSIST, serializeState } from "@/lib/query-persist";
import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { Suspense, useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/nana/project", () => ({
  useChain: () => undefined,
  useJBChainId: () => 1,
  useJBProject: () => ({ chainId: 1, projectId: 1n }),
  useJBProjectMetadataContext: () => ({ metadata: { data: { name: "Fixture Revnet" } } }),
  useJBTokenContext: () => ({ token: { data: undefined } }),
}));
vi.mock("@/lib/nana/suckers", () => ({ useSuckers: () => ({ data: [] }) }));
// Keep fresh reads pending so only the restored values can populate the header.
vi.mock("@/lib/bendystraw/client", () => ({
  queryBendystrawFromBrowser: () => new Promise(() => {}),
}));
vi.mock("@/components/SafeBadge", () => ({ SafeBadge: () => null }));
vi.mock("@/hooks/ens/useEnsName", () => ({ useEnsName: () => ({ data: null }) }));
vi.mock("@/components/IpfsImage", () => ({ ImageWithFallback: () => null, IpfsImage: () => null }));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getPublicClient: () => ({ readContract: () => new Promise(() => {}) }),
}));

const projects: ComponentProps<typeof Header>["projects"] = [
  {
    chainId: 1,
    projectId: 1,
    suckerGroupId: "fixture",
    token: "0x000000000000000000000000000000000000eeee",
    decimals: 18,
    balance: "0",
    tokenSymbol: "FREV",
  },
];
const operatorPromise = Object.assign(Promise.resolve(null), { status: "fulfilled", value: null });
const participantsKey = ["complete-participants", { suckerGroupId: "fixture", balance_gt: "0" }, 1];
const treasuryKey = ["revnet", "treasury", [[1, 1]]];
const cachedTreasury = [
  {
    chainId: 1,
    verified: true,
    rows: [
      {
        chainId: 1,
        token: projects[0].token,
        symbol: "ETH",
        decimals: 18,
        balance: 1n,
        usd: 1250n * 10n ** 18n,
      },
    ],
  },
];

it("names the operator by address when it has no profile", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const address = "0xbb96a6d3d251dfda76f96d1650f9cfd53b41c8d1";
  const known = Object.assign(Promise.resolve({ address }), {
    status: "fulfilled",
    value: { address },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <Suspense>
            <Header isRevnet operatorPromise={known} projects={projects} createdAt={0} />
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  expect(container).toHaveTextContent("Operator:");
  expect(container.querySelector(`a[href$="${address}"]`)).toHaveTextContent(/^0xbb96\.\.\.c8d1$/i);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["treasury", 2, "ready"],
  ["treasury", 2, "unavailable"],
  ["participants", 0, "ready"],
  ["participants", 1, "ready"],
  ["participants", 2, "ready"],
  ["participants", 2, "unavailable"],
  ["participants", 2, "revalidating"],
  ["both", 2, "ready"],
] as const)(
  "hydrates the header with persisted %s and %s owners (%s) without replacing its SSR nodes",
  async (kind, count, state) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const server = new QueryClient();
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: state === "revalidating" ? 0 : Infinity } },
    });
    const previous = new QueryClient();
    const participants = Array.from({ length: count }, (_, index) => ({
      address: `0x${String(index + 1).repeat(40)}`,
      chainId: 1,
      balance: "1",
    }));
    const treasury =
      state === "unavailable" ? [{ chainId: 1, verified: false, rows: [] }] : cachedTreasury;
    if (kind !== "participants") {
      previous.setQueryDefaults(treasuryKey, { meta: PERSIST });
      previous.setQueryData(treasuryKey, treasury);
    }
    if (kind !== "treasury") {
      previous.setQueryDefaults(participantsKey, { meta: PERSIST });
      previous.setQueryData(participantsKey, participants);
    }
    const storageKey = "revnet:query-cache:v1";
    const oldStore = window.localStorage.getItem(storageKey);
    window.localStorage.setItem(storageKey, serializeState(dehydrate(previous)));
    const component =
      kind === "treasury" ? (
        <TvlDatum projects={projects} />
      ) : (
        <Header isRevnet operatorPromise={operatorPromise} projects={projects} createdAt={0} />
      );
    const tree = (queryClient: QueryClient) => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Suspense>{component}</Suspense>
        </TooltipProvider>
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree(server));
    document.body.append(container);
    const serverRoot = container.firstElementChild;
    const serverBalance = container.querySelector(".text-black");
    const serverOwners = container.querySelector(".text-black-500");
    expect(serverBalance).toHaveTextContent("…");
    if (kind !== "treasury") expect(serverOwners).toHaveTextContent("…");
    // Simulate a streamed child hydrating after the provider restored the previous session.
    const stop = installQueryPersistence(client, window.localStorage);
    if (kind === "participants" && state === "unavailable") {
      // A fresh read can fail after restoration but before a streamed header hydrates.
      await client
        .fetchQuery({
          queryKey: participantsKey,
          queryFn: async () => {
            throw new Error("Participant read unavailable");
          },
          staleTime: 0,
          retry: false,
        })
        .catch(() => undefined);
    }
    const errors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree(client), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(errors).toEqual([]);
      expect(container.firstElementChild).toBe(serverRoot);
      expect(container.querySelector(".text-black")).toBe(serverBalance);
      if (kind !== "participants") {
        expect(serverBalance).toHaveTextContent(state === "unavailable" ? "—" : "$1,250.00");
        expect(client.getQueryData(treasuryKey)).toEqual(treasury);
      }
      if (kind !== "treasury") {
        expect(container.querySelector(".text-black-500")).toBe(serverOwners);
        expect(serverOwners).toHaveTextContent(state === "unavailable" ? "—" : String(count));
        if (state === "unavailable") {
          expect(serverOwners).toHaveAttribute("title", "Owner data is unavailable.");
        } else {
          expect(serverOwners).not.toHaveAttribute("title");
        }
        if (state === "revalidating") {
          expect(serverOwners?.querySelector(".revalidating")).toHaveAttribute("aria-busy", "true");
          expect(serverOwners?.querySelector(".revalidating")).toHaveAttribute(
            "title",
            "Confirming against the chain…",
          );
        }
        expect(serverOwners?.parentElement?.textContent).toBe(
          `${state === "unavailable" ? "—" : count} ${count === 1 ? "owner" : "owners"}`,
        );
        expect(client.getQueryData(participantsKey)).toEqual(participants);
      }
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

it("shows restored treasury on the first ordinary client-navigation commit", async () => {
  const client = new QueryClient();
  client.setQueryData(treasuryKey, cachedTreasury);
  const container = document.createElement("div");
  document.body.append(container);
  let firstCommit = "";
  function ObserveFirstCommit() {
    useLayoutEffect(() => {
      firstCommit = container.textContent ?? "";
    }, []);
    return <TvlDatum projects={projects} />;
  }
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <ObserveFirstCommit />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    expect(firstCommit).toBe("$1,250.00 balance");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
