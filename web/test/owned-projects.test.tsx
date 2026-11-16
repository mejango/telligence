import { OwnedProjects } from "@/app/account/[id]/components/OwnedProjects";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { provenSafe, SAFE_OWNER_A, safeChain } from "./fixtures/safe-chain";

const SAFE = provenSafe();
const SAFE_PROJECT = {
  chainId: 8453,
  projectId: 42,
  version: 6,
  name: "Safe project",
  handle: null,
  logoUri: null,
  owner: SAFE.address.toLowerCase(),
  isRevnet: true,
  suckerGroupId: null,
  tokenSymbol: "SAFE",
  createdAt: 0,
};

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: () => safeChain(SAFE.address).client,
}));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectsByOwner: (where: { owner?: string }, enabled = true) => ({
    data: where.owner || !enabled ? [] : [SAFE_PROJECT],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

describe("projects owned through a Safe", () => {
  let service: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === `https://juicebox.center/v1/safe/base/api/v1/owners/${SAFE_OWNER_A}/safes/`
        ? new Response(JSON.stringify({ safes: [SAFE.address] }))
        : new Response("Not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", service);
  });

  it("asks each mainnet's Safe service and shows the Safe's live policy", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OwnedProjects address={SAFE_OWNER_A.toLowerCase() as typeof SAFE_OWNER_A} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/via Safe .*\(2\/2\)/)).toBeVisible();
    expect(service.mock.calls.map(([url]) => String(url)).sort()).toEqual(
      ["arb1", "base", "eth", "oeth"].map(
        (prefix) =>
          `https://juicebox.center/v1/safe/${prefix}/api/v1/owners/${SAFE_OWNER_A}/safes/`,
      ),
    );
  });
});
