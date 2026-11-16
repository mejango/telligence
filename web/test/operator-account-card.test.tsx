import { OperatorAccountCard } from "@/app/[slug]/components/v6/operator/OperatorAccountCard";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupGateState } from "./support/group-write-gate";

const NEXT = "0x3333333333333333333333333333333333333333";

const mocks = vi.hoisted(() => ({ runWrites: vi.fn() }));
vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

// The operator and account-type reads need bendystraw and RPC; the card's
// transfer flow is what these tests are about.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const queryClient = new actual.QueryClient();
  return {
    ...actual,
    useQueryClient: () => queryClient,
    queryOptions: (options: unknown) => options,
    useQueries: () => [
      {
        data: { kind: "eoa", address: "0x2222222222222222222222222222222222222222" },
        isLoading: false,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      },
    ],
  };
});
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({
    operatorByChain: new Map([[8453, "0x2222222222222222222222222222222222222222"]]),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useOperatorWrites", () => ({
  useOperatorWrites: () => ({ runWrites: mocks.runWrites }),
}));
vi.mock("@/lib/reviewed-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reviewed-call")>()),
  isSafeProposalPendingError: (error: unknown) =>
    error instanceof Error && error.name === "SafeProposalPendingError",
}));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    connectWalletText: _connect,
    loading: _loading,
    targetChainId: _chain,
    ...props
  }: {
    children: ReactNode;
    connectWalletText?: string;
    loading?: boolean;
    targetChainId?: number;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x2222222222222222222222222222222222222222" }),
}));

/** Fills the transfer form and opens its confirm. */
async function openConfirm() {
  render(
    <OperatorAccountCard
      rows={[{ chainId: 8453, projectId: 6 }]}
      fallbackProject={{ chainId: 8453, projectId: 6 }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Transfer revnet operator" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New revnet operator" }), {
    target: { value: NEXT },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Transfer revnet operator" }));
  return (await screen.findByRole("dialog", { name: "Confirm transfer" })) as HTMLDialogElement;
}

beforeEach(() => {
  groupGateState.reset();
  mocks.runWrites.mockResolvedValue({ chains: 1, safeQueued: 0, safeConfirmed: 0 });
});

describe("transfer revnet operator to sucker-group rows", () => {
  it("wallet-action:operator-writes refuses a row the sucker registry does not list", async () => {
    groupGateState.unverified = ["8453:6"];
    render(
      <OperatorAccountCard
        rows={[{ chainId: 8453, projectId: 6 }]}
        fallbackProject={{ chainId: 8453, projectId: 6 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transfer revnet operator" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New revnet operator" }), {
      target: { value: NEXT },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("A project listed here isn't linked onchain.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Transfer revnet operator" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to batch" })).toBeDisabled();
    expect(mocks.runWrites).not.toHaveBeenCalled();
  });
});

describe("transfer revnet operator confirm", () => {
  it("wallet-action:operator-writes refuses every way out while the transfer is sending, then closes when it lands", async () => {
    let finish!: (result: unknown) => void;
    mocks.runWrites.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const confirm = await openConfirm();
    await waitFor(() => expect(mocks.runWrites).toHaveBeenCalledOnce());

    const close = within(confirm).getByRole("button", { name: "Close" });
    expect(close).toBeDisabled();
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(confirm);
    expect(screen.getByRole("dialog", { name: "Confirm transfer" })).toBe(confirm);

    await act(async () => finish({ chains: 1, safeQueued: 0, safeConfirmed: 0 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Landed: the flow closes back to its button.
    expect(screen.queryByRole("textbox", { name: "New revnet operator" })).toBeNull();
    expect(screen.getByRole("button", { name: "Transfer revnet operator" })).toBeEnabled();
    expect(mocks.runWrites).toHaveBeenCalledOnce();
  });

  it("ends on Done when the transfer went to the Safe as a proposal", async () => {
    mocks.runWrites.mockRejectedValue(
      Object.assign(new Error("Transfer revnet operator was proposed to Safe."), {
        name: "SafeProposalPendingError",
      }),
    );
    const confirm = await openConfirm();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Transfer revnet operator was proposed to Safe.");
    expect(within(confirm).queryByRole("button", { name: "Transfer revnet operator" })).toBeNull();
    fireEvent.click(done);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Transfer revnet operator was proposed to Safe.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.runWrites).toHaveBeenCalledOnce();
  });
});
