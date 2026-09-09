import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getEnsName: vi.fn() }));
vi.mock("@/lib/ensPublicClient", () => ({
  getEnsPublicClient: () => ({ getEnsName: mocks.getEnsName }),
}));

import { useEnsName } from "@/hooks/ens/useEnsName";

it("resolves displayed ENS identities without adding Ethereum to the wallet configuration", async () => {
  mocks.getEnsName.mockResolvedValue("artizenendowment.eth");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const address = "0x2222222222222222222222222222222222222222";
  const { result } = renderHook(() => useEnsName(address), { wrapper });
  await waitFor(() => expect(result.current.data).toBe("artizenendowment.eth"));
  expect(mocks.getEnsName).toHaveBeenCalledWith({ address });
});
