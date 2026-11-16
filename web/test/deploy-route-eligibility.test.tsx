import { DeploySection } from "@/app/create/form/DeploySection";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";

const mocks = vi.hoisted(() => ({
  account: { connector: { id: "injected", name: "Injected" }, chainId: 10 },
  form: {} as Record<string, unknown>,
  submitForm: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => mocks.account }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  useSafeConnection: () => mocks.account.connector.id === "safe",
}));
// The form's submit is in flight from the press until its promise settles, as
// the create form's own submitForm is.
vi.mock("@/app/create/form/useCreateForm", async () => {
  const { useState } = await import("react");
  return {
    useCreateForm: () => {
      const [isSubmitting, setSubmitting] = useState(false);
      return {
        ...mocks.form,
        isSubmitting,
        submitForm: async () => {
          setSubmitting(true);
          try {
            await mocks.submitForm();
          } finally {
            setSubmitting(false);
          }
        },
      };
    },
  };
});
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    disabled,
    onClick,
    targetChainId,
  }: {
    children: React.ReactNode;
    disabled: boolean;
    onClick: () => void;
    targetChainId: number;
  }) => (
    <button disabled={disabled} onClick={onClick} data-chain={targetChainId}>
      {children}
    </button>
  ),
}));

beforeEach(() => {
  mocks.account = { connector: { id: "injected", name: "Injected" }, chainId: 10 };
  mocks.form = {
    values: { ...validRevnetForm(), chainIds: [1, 10] },
    revnetTokenSymbol: "TEST",
    reserveAssetSymbol: "ETH",
    submitForm: mocks.submitForm,
    isSubmitting: false,
    isValid: true,
    errors: {},
    submitCount: 0,
  };
});

describe("creation route eligibility", () => {
  it("keeps the connected funding preference while reviewing supported mainnet EOA launch", () => {
    render(<DeploySection />);
    const button = screen.getByRole("button", { name: "Sign and get quote" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("data-chain", "10");
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Confirm deploy request" })).toBeInTheDocument();
  });

  it.each([
    [1, 10],
    [11155111, 84532],
  ])(
    "guides Safe multichain launch back to single-chain deployment before review (%s, %s)",
    (...chainIds) => {
      mocks.account.connector = { id: "safe", name: "Safe" };
      mocks.form.values = { ...validRevnetForm(), chainIds };
      render(<DeploySection />);
      expect(screen.getByRole("alert")).toHaveTextContent("select one chain");
      const button = screen.getByRole("button", { name: "Sign and get quote" });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.submitForm).not.toHaveBeenCalled();
    },
  );

  it("allows all four supported testnets in one EOA launch", () => {
    mocks.account.chainId = 84532;
    mocks.form.values = { ...validRevnetForm(), chainIds: [11155111, 11155420, 84532, 421614] };
    render(<DeploySection />);
    const button = screen.getByRole("button", { name: "Sign and get quote" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("data-chain", "84532");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Confirm deploy request" })).toBeInTheDocument();
  });

  it.each([
    { chainIds: [1, 10], connectedChainId: 84532 },
    { chainIds: [11155111, 84532], connectedChainId: 10 },
  ])("does not prefer funding on another network family", ({ chainIds, connectedChainId }) => {
    mocks.account.chainId = connectedChainId;
    mocks.form.values = { ...validRevnetForm(), chainIds };
    render(<DeploySection />);
    const button = screen.getByRole("button", { name: "Sign and get quote" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("data-chain");
  });

  it.each([
    [1, 84532],
    [11155111, 10],
    [1, 999999],
  ])("rejects mixed or unsupported destinations before review (%s, %s)", (...chainIds) => {
    mocks.form.values = { ...validRevnetForm(), chainIds };
    render(<DeploySection />);
    expect(screen.getByRole("alert")).toHaveTextContent("either live chains or test chains");
    const button = screen.getByRole("button", { name: "Sign and get quote" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.submitForm).not.toHaveBeenCalled();
  });

  it("retains direct single-chain Safe/testnet deployment", () => {
    mocks.account.connector = { id: "safe", name: "Safe" };
    mocks.form.values = { ...validRevnetForm(), chainIds: [11155111] };
    render(<DeploySection />);
    expect(screen.getByRole("button", { name: "Deploy the revnet" })).toBeEnabled();
  });
});

describe("deployment confirm", () => {
  it("wallet-action:create-revnet refuses every way out while the request is signed, then closes", async () => {
    let finish!: () => void;
    mocks.submitForm.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<DeploySection />);
    fireEvent.click(screen.getByRole("button", { name: "Sign and get quote" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(mocks.submitForm).toHaveBeenCalledTimes(1));

    expectEveryWayOutRefused(confirm);

    finish();
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(mocks.submitForm).toHaveBeenCalledTimes(1);
  });
});
