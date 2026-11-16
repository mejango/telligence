import { ProjectProvider, useJBContractContext } from "@/lib/nana/project";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { custom, encodeAbiParameters, type Address } from "viem";
import { optimism } from "viem/chains";
import { expect, it, vi } from "vitest";
import { createConfig, WagmiProvider } from "wagmi";

vi.mock("@bananapus/nana-sdk-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core")>()),
  getProjectMetadata: async () => null,
}));
vi.mock("wagmi", async (importOriginal) => {
  const wagmi = await importOriginal<typeof import("wagmi")>();
  return {
    ...wagmi,
    // Exercise the actual controller hook/cache/transport. Unrelated provider
    // reads are outside this freshness regression and need no network fixture.
    useReadContract: (parameters: Parameters<typeof wagmi.useReadContract>[0]) =>
      parameters?.functionName === "controllerOf"
        ? wagmi.useReadContract(parameters)
        : { data: undefined, isLoading: false, error: null, refetch: vi.fn() },
  };
});

function Controller() {
  const state = useJBContractContext().contracts.controller;
  return <p>{state.data ?? state.error?.message}</p>;
}

it("reuses a controller for the app's 30-second window and discovers migration on revisit", async () => {
  const before: Address = "0x0000000000000000000000000000000000001111";
  const after: Address = "0x0000000000000000000000000000000000002222";
  let controller = before;
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method !== "eth_call") throw new Error(`Unexpected method: ${method}`);
    return encodeAbiParameters([{ type: "address" }], [controller]);
  });
  const config = createConfig({
    chains: [optimism],
    batch: { multicall: false },
    transports: { [optimism.id]: custom({ request }) },
    ssr: true,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const view = () => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>
        <ProjectProvider projectId={7n} chainId={10}>
          <Controller />
        </ProjectProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
  const first = render(view());
  expect(await screen.findByText(before)).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  first.unmount();
  controller = after;
  now.mockReturnValue(1_029_999);
  const freshRevisit = render(view());
  expect(screen.getByText(before)).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  freshRevisit.unmount();
  now.mockReturnValue(1_030_001);
  render(view());
  expect(await screen.findByText(after)).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});
