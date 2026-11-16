import { V6BurnTokensDialog } from "@/app/[slug]/components/v6/owners/accounts/V6BurnTokensDialog";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { REVIEWED_ENGINE_LOAD_LINE } from "@bananapus/nana-sdk-core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

// revnet's reviewed send owns its own preparation (the Safe wallet peer check, the shop voting
// policy's chunk): when it fails, every flow gets the same "nothing was sent" line, through the
// real wrapper, with no catch of its own. Burn is the flow here.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const CONTROLLER = "0x2222222222222222222222222222222222222222" as Address;

const mocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useConfig: () => ({}),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  usePublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "totalBalanceOf" ? 10n ** 21n : CONTROLLER,
  }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: ACCOUNT, connector: { id: "a" } }),
  getPublicClient: () => undefined,
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
}));
vi.mock("@/lib/safe-connector", () => ({
  isSafeConnection: () => false,
  safeWalletPeerSettled: async () => {
    throw new Error("Failed to fetch dynamically imported module");
  },
}));
vi.mock("@bananapus/nana-sdk-core/review/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review/react")>()),
  useReviewedRun: () => ({ run: mocks.run, phase: "idle", failure: null, error: null }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    variant: _variant,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("a reviewed send whose own preparation fails", () => {
  it("says nothing was sent and frees the burn, with no review or wallet opened", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <V6BurnTokensDialog
          rows={[{ chainId: 8453 as JBChainId, projectId: 4n, balance: 10n ** 21n }]}
          tokenSymbol="ART"
        >
          <button>Burn</button>
        </V6BurnTokensDialog>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Burn" }));
    fireEvent.change(await screen.findByPlaceholderText("Amount of ART"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Burn permanently" }));

    expect(await screen.findByText(REVIEWED_ENGINE_LOAD_LINE)).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
