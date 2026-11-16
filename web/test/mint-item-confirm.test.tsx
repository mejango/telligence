import { MintItemModal } from "@/app/[slug]/components/v6/shop/MintItemModal";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectEveryWayOutRefused, findConfirm } from "./support/confirm";

const HOOK = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"cd".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({ write: vi.fn(), canMint: vi.fn() }));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }),
  usePublicClient: () => ({}),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionThrough } = await import("./support/reviewed-action");
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: reviewedActionThrough(mocks.write).hook,
  };
});
// The live shop and permission check the modal runs before its confirm opens.
vi.mock("@/app/[slug]/components/v6/shop/shopPermissions", () => ({
  assertCanMint721Tier: mocks.canMint,
}));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: async () => ({ status: "success" }),
}));

/** Opens the mint modal and its progress, which starts the mint once the live check passes. */
async function openConfirm() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MintItemModal
        chainId={8453 as JBChainId}
        projectId={4n}
        hook={HOOK}
        tierId={7}
        itemName="Poster"
        remaining={5}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mint" }));
  const confirm = await findConfirm();
  return confirm;
}

beforeEach(() => {
  mocks.canMint.mockReset().mockResolvedValue(undefined);
  mocks.write.mockReset().mockResolvedValue(HASH);
});

describe("mint without payment confirm", () => {
  it("wallet-action:shop-items refuses every way out from Confirm through the send, then shows the mint", async () => {
    let answer!: () => void;
    mocks.write.mockReturnValue(
      new Promise((resolve) => {
        answer = () => resolve(HASH);
      }),
    );
    const confirm = await openConfirm();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);

    await act(async () => answer());
    expect(await screen.findByText("Items minted")).toBeInTheDocument();
    expect(document.querySelector("[data-tx-confirm]")).toBeNull();
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toMatchObject({
      chainId: 8453,
      address: HOOK,
      functionName: "mintFor",
      args: [[7], "0x1111111111111111111111111111111111111111"],
    });
  });
});
