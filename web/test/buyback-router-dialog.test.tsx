import {
  BuybackRouterCard,
  READ_FAILED_LINE,
} from "@/app/[slug]/components/v6/operator/BuybackRouterCard";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupGateState } from "./support/group-write-gate";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));
beforeEach(() => {
  groupGateState.reset();
  chainRead.readFailed = false;
});

// The card reads chain state on mount; stub it so the test is about the shell,
// not the RPC. One chain with an initialized USDC pool = every action available.
const chainRead = vi.hoisted(() => ({ readFailed: false }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        readFailed: chainRead.readFailed,
        chainId: 8453,
        projectId: 6,
        buybackRegistry: "0x1111111111111111111111111111111111111111",
        routerRegistry: "0x2222222222222222222222222222222222222222",
        buybackAvailable: true,
        routerAvailable: true,
        hook: "0x3333333333333333333333333333333333333333",
        terminal: "0x4444444444444444444444444444444444444444",
        defaultHook: "0x5555555555555555555555555555555555555555",
        defaultTerminal: "0x6666666666666666666666666666666666666666",
        pools: [
          { label: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", twap: 172800 },
        ],
        poolSummary: "USDC pool · TWAP 172800s",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/reviewed-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reviewed-call")>()),
  isSafeProposalPendingError: (error: unknown) =>
    error instanceof Error && error.name === "SafeProposalPendingError",
}));
const writes = vi.hoisted(() => ({ runWrites: vi.fn() }));
vi.mock("@/app/[slug]/components/v6/operator/useOperatorWrites", () => ({
  useOperatorWrites: () => ({ runWrites: writes.runWrites }),
}));
// The live operator read needs bendystraw + RPC; the shell test has neither.
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({ operatorByChain: new Map(), isLoading: false }),
}));
// ENS lookups need a wagmi provider this test has no business standing up.
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    connectWalletText: _connectWalletText,
    loading: _loading,
    targetChainId: _targetChainId,
    ...props
  }: {
    children: React.ReactNode;
    connectWalletText?: string;
    loading?: boolean;
    targetChainId?: number;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
const ENS_TOKEN = "0x9999999999999999999999999999999999999999";
const ens = vi.hoisted(() => ({ token: "0x9999999999999999999999999999999999999999" }));
vi.mock("@/hooks/ens/useEnsAddress", () => ({
  useEnsAddress: (name: string | undefined) => ({
    data: name === "pair.eth" ? ens.token : null,
    isLoading: false,
  }),
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: `0x${"22".repeat(20)}`, chainId: 8453 }),
  useChainId: () => 8453,
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
}));

describe("BuybackRouterCard over sucker-group rows", () => {
  it("wallet-action:operator-writes refuses a chain whose project the registry does not list", async () => {
    groupGateState.unverified = ["8453:6"];
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));
    const dialog = await screen.findByRole("dialog", { name: "Set TWAP window" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I verified every selected/ }));
    expect(within(dialog).getByText("A project listed here isn't linked onchain.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Set TWAP window" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Add to batch" })).toBeDisabled();
    expect(writes.runWrites).not.toHaveBeenCalled();
  });
});

describe("BuybackRouterCard", () => {
  it("says a chain could not be read instead of calling its hook unset", async () => {
    chainRead.readFailed = true;
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    expect(screen.getAllByText(READ_FAILED_LINE).length).toBeGreaterThan(0);
    expect(screen.queryByText("Not set")).toBeNull();
  });

  it("opens each action's form in a modal dialog, not inline", async () => {
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);

    // Closed: the form's fields are nowhere in the card.
    expect(screen.queryByText("Run on")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));

    await waitFor(() => expect(screen.getByText("Run on")).toBeTruthy());
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    // The form lives INSIDE the dialog — an inline render would fail this.
    expect(dialog!.contains(screen.getByText("Run on"))).toBe(true);
    expect(dialog!.querySelector("input[type=checkbox]")).toBeTruthy();
  });

  it("pre-fills hook and terminal edits from the live registry defaults", async () => {
    const view = render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set buyback hook" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("0x5555555555555555555555555555555555555555")).toBeTruthy(),
    );
    view.unmount();
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set router terminal" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("0x6666666666666666666666666666666666666666")).toBeTruthy(),
    );
  });

  it("pre-fills the pair token from the pool that exists", async () => {
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));

    await waitFor(() => expect(screen.getByText("Run on")).toBeTruthy());
    const dialog = document.querySelector("dialog")!;
    const values = [...dialog.querySelectorAll("input")].map((input) => input.value);
    // USDC on Base, not the native sentinel — ART has no native pool.
    expect(values).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(values).toContain("172800");
  });

  it("keeps an action's dialog open while its confirm is sending", async () => {
    let finish!: (result: unknown) => void;
    writes.runWrites.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));
    const dialog = (await screen.findByRole("dialog", {
      name: "Set TWAP window",
    })) as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I verified every selected/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Set TWAP window" }));
    // The confirm replaces the form inside the same dialog.
    await waitFor(() => expect(dialog.querySelector("[data-tx-confirm]")).not.toBeNull());
    const confirm = dialog.querySelector<HTMLElement>("[data-tx-confirm]")!;
    await waitFor(() => expect(writes.runWrites).toHaveBeenCalledTimes(1));

    // Every way out is refused while the write is in flight.
    expect(within(confirm).getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);
    const close = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Close",
    )!;
    expect(close).toBeDisabled();
    fireEvent.click(close);
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Set TWAP window" })).toBe(dialog);

    await act(async () => finish({ chains: 1, safeQueued: 0, safeConfirmed: 0 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("takes an ENS name for a per-chain address and sends the address it resolves to", async () => {
    let finish!: (result: unknown) => void;
    writes.runWrites.mockReset();
    writes.runWrites.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const view = render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));
    const dialog = await screen.findByRole("dialog", { name: "Set TWAP window" });
    const field = within(dialog).getByRole("textbox", { name: /on Base/ });
    const submit = () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Set TWAP window" }));
    };
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I verified every selected/ }));

    // A name that resolves to nothing stops at the form.
    fireEvent.change(field, { target: { value: "nobody.eth" } });
    expect(within(dialog).getByText("Name not found")).toBeInTheDocument();
    submit();
    expect(await within(dialog).findByText(/enter a valid/)).toBeInTheDocument();
    expect(writes.runWrites).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "pair.eth" } });
    expect(within(dialog).getByText(`→ ${ENS_TOKEN}`)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(writes.runWrites).toHaveBeenCalledTimes(1));
    // The review names the address with the name it was typed as; the call carries the address.
    expect(dialog.querySelector("[data-tx-confirm]")?.textContent).toContain(
      `${ENS_TOKEN} (pair.eth)`,
    );
    expect(
      JSON.stringify(writes.runWrites.mock.calls[0], (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).toContain(ENS_TOKEN);
    // The name resolving elsewhere later does not rename what the reviewed call carries.
    ens.token = `0x${"77".repeat(20)}`;
    view.rerender(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    expect(dialog.querySelector("[data-tx-confirm]")?.textContent).toContain(
      `${ENS_TOKEN} (pair.eth)`,
    );
    ens.token = ENS_TOKEN;
    await act(async () => finish({ chains: 1, safeQueued: 0, safeConfirmed: 0 }));
  });

  it("ends on Done when the action went to the Safe as a proposal", async () => {
    const proposal = Object.assign(
      new Error("Set TWAP window was proposed to Safe, but it has not executed."),
      { name: "SafeProposalPendingError" },
    );
    writes.runWrites.mockRejectedValue(proposal);
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));
    const dialog = await screen.findByRole("dialog", { name: "Set TWAP window" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I verified every selected/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Set TWAP window" }));
    await waitFor(() => expect(dialog.querySelector("[data-tx-confirm]")).not.toBeNull());
    const confirm = dialog.querySelector<HTMLElement>("[data-tx-confirm]")!;

    // Nothing is left to send from here: Done, not the action again.
    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("was proposed to Safe");
    expect(within(confirm).queryByRole("button", { name: "Set TWAP window" })).toBeNull();
    expect(within(confirm).queryByRole("alert")).toBeNull();
    fireEvent.click(done);

    await waitFor(() => expect(dialog.querySelector("[data-tx-confirm]")).toBeNull());
    expect(within(dialog).getByText(/was proposed to Safe/)).toBeInTheDocument();
    expect(writes.runWrites).toHaveBeenCalledTimes(1);
  });
});
