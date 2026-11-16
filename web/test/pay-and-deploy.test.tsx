import type {
  ChainPayment,
  RelayrGetBundleResponse,
  RelayrPostBundleResponse,
} from "@/lib/nana/types";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";

const mocks = vi.hoisted(() => ({
  sendRelayrTx: vi.fn(),
  startPolling: vi.fn(),
  paymentHash: undefined as string | undefined,
  safe: false,
  /** Whether a wallet is connected. ButtonWithWallet's own test pins what it shows without one. */
  connected: true,
  bundle: {
    response: undefined as RelayrGetBundleResponse | undefined,
    error: undefined as unknown,
    isPolling: false,
    isComplete: false,
    hasFailed: false,
  },
}));

vi.mock("@/hooks/useReviewedRelayr", () => ({
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.sendRelayrTx, data: mocks.paymentHash }),
  useGetRelayrTxBundle: () => ({ ...mocks.bundle, startPolling: mocks.startPolling }),
}));
vi.mock("@/lib/held-rows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/held-rows")>()),
  submittedViaSafe: () => mocks.safe,
}));
vi.mock("@/app/create/form/useCreateForm", () => ({
  useCreateForm: () => ({ values: { name: "Test revnet", chainIds: [1, 8453] } }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText,
    ...props
  }: {
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: number;
    connectWalletText?: string;
  }) =>
    mocks.connected ? (
      <button {...props}>{children}</button>
    ) : (
      <button type="button">{connectWalletText ?? "Connect Wallet"}</button>
    ),
}));
vi.mock("@/lib/nana/project", () => ({ useChain: () => undefined, useJBChainId: () => undefined }));
vi.mock("@/app/create/buttons/GoToProjectButton", () => ({
  GoToProjectButton: ({ txHash, chainId }: { txHash?: string; chainId: number }) => (
    <button data-tx-hash={txHash} data-chain={chainId}>
      Go to your revnet
    </button>
  ),
}));

import { PayAndDeploy } from "@/app/create/buttons/PayAndDeploy";

const HASH = `0x${"ab".repeat(32)}` as const;
const BASE_HASH = `0x${"cd".repeat(32)}` as const;
const PAYMENT: ChainPayment = {
  chain: 1,
  amount: "0xde0b6b3a7640000",
  calldata: "0x",
  target: `0x${"11".repeat(20)}`,
  token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  payment_deadline: "9999999999",
};
const QUOTE: RelayrPostBundleResponse = {
  bundle_uuid: "deploy-bundle",
  payment_info: [PAYMENT],
};

function component() {
  return <PayAndDeploy relayrResponse={QUOTE} revnetTokenSymbol="REV" />;
}

async function confirmPayment() {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Ethereum (1 ETH)" }));
  fireEvent.click(screen.getByRole("button", { name: "Pay and launch" }));
  await waitFor(() => expect(mocks.sendRelayrTx).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  mocks.paymentHash = undefined;
  mocks.safe = false;
  mocks.connected = true;
  mocks.bundle = {
    response: undefined,
    error: undefined,
    isPolling: false,
    isComplete: false,
    hasFailed: false,
  };
  mocks.sendRelayrTx.mockResolvedValue(HASH);
  mocks.startPolling.mockImplementation(() => {
    mocks.bundle.isPolling = true;
  });
});

describe("PayAndDeploy settlement", () => {
  const BASE_PAYMENT: ChainPayment = { ...PAYMENT, chain: 8453, amount: "0x38d7ea4c68000" };

  it.each([
    { preferred: 8453, payments: [PAYMENT, BASE_PAYMENT], shown: "Base (0.001 ETH)" },
    { preferred: 10, payments: [PAYMENT], shown: "Ethereum (1 ETH)" },
    { preferred: 10, payments: [PAYMENT, BASE_PAYMENT], shown: "Select chain" },
    { preferred: undefined, payments: [PAYMENT, BASE_PAYMENT], shown: "Select chain" },
  ])(
    "preselects $shown for chain $preferred and $payments.length quotes",
    ({ preferred, payments, shown }) => {
      render(
        <PayAndDeploy
          relayrResponse={{ ...QUOTE, payment_info: payments }}
          preferredPaymentChainId={preferred}
          revnetTokenSymbol="REV"
        />,
      );

      expect(screen.getByRole("combobox")).toHaveTextContent(shown);
      expect(screen.getByRole("button", { name: "Pay and launch" })).toHaveProperty(
        "disabled",
        shown === "Select chain",
      );
    },
  );

  it("shows a verification failure without a bundle response and keeps funding locked", async () => {
    const view = render(component());
    await confirmPayment();
    await waitFor(() => expect(mocks.startPolling).toHaveBeenCalledWith(QUOTE.bundle_uuid));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    mocks.bundle = {
      ...mocks.bundle,
      isPolling: false,
      hasFailed: true,
      error: new Error("The onchain destination transaction does not match the signed request."),
    };
    view.rerender(component());

    expect(screen.getByRole("alert")).toHaveTextContent("does not match the signed request");
    expect(screen.getByRole("alert")).toHaveTextContent("Do not make another payment");
    const pay = screen.getByRole("button", { name: "Pay and launch" });
    expect(pay).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
    fireEvent.click(pay);
    expect(mocks.sendRelayrTx).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Go to your revnet" })).not.toBeInTheDocument();
  });

  it.each(["Success", "Completed"] as const)(
    "uses %s destination hashes for explorer links and the deployment landing",
    (state) => {
      mocks.bundle = {
        ...mocks.bundle,
        isComplete: true,
        response: {
          bundle_uuid: QUOTE.bundle_uuid,
          transactions: [
            {
              tx_uuid: "ethereum-deploy",
              request: { chain: 1 },
              status: {
                state,
                data: state === "Success" ? { hash: HASH } : { transaction: { hash: HASH } },
              },
            },
            {
              tx_uuid: "base-deploy",
              request: { chain: 8453 },
              status: {
                state,
                data:
                  state === "Success" ? { hash: BASE_HASH } : { transaction: { hash: BASE_HASH } },
              },
            },
          ],
        } as RelayrGetBundleResponse,
      };
      render(component());

      expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        `https://etherscan.io/tx/${HASH}`,
        `https://basescan.org/tx/${BASE_HASH}`,
      ]);
      expect(screen.getByRole("button", { name: "Go to your revnet" })).toHaveAttribute(
        "data-tx-hash",
        HASH,
      );
      expect(screen.getByRole("button", { name: "Go to your revnet" })).toHaveAttribute(
        "data-chain",
        "1",
      );
      expect(screen.getByRole("button", { name: "Pay and launch" })).toBeDisabled();
    },
  );

  it("keeps a submitted Safe proposal locked and explains the remaining action", async () => {
    mocks.safe = true;
    render(component());
    await confirmPayment();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(screen.getByText(/Complete the existing payment proposal in Safe/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay and launch" })).toBeDisabled();
    expect(mocks.startPolling).not.toHaveBeenCalled();
  });

  it("lets a failed receipt review close without enabling another broadcast", async () => {
    mocks.sendRelayrTx.mockImplementation(async () => {
      mocks.paymentHash = HASH;
      throw new Error("Payment confirmation is uncertain.");
    });
    render(component());
    await confirmPayment();

    const dialog = screen.getByRole("dialog", { name: "Confirm payment" });
    await within(dialog).findByText("Payment confirmation is uncertain.");
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).not.toBeDisabled();
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const pay = screen.getByRole("button", { name: "Pay and launch" });
    expect(pay).toBeDisabled();
    fireEvent.click(pay);
    expect(mocks.sendRelayrTx).toHaveBeenCalledTimes(1);
  });

  it("wallet-action:create-revnet refuses every way out while the payment is sent, then closes once it is", async () => {
    let finish!: (hash: string) => void;
    mocks.sendRelayrTx.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(component());
    await confirmPayment();
    const confirm = await findConfirm();

    expectEveryWayOutRefused(confirm);

    finish(HASH);
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(mocks.startPolling).toHaveBeenCalledWith(QUOTE.bundle_uuid);
    expect(mocks.sendRelayrTx).toHaveBeenCalledTimes(1);
  });

  it("asks for a wallet before the payment's confirm opens", () => {
    mocks.connected = false;
    render(component());

    expect(screen.queryByRole("button", { name: "Pay and launch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(confirmIsOpen()).toBe(false);
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
  });
});
