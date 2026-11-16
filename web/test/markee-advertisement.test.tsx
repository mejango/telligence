// @vitest-environment jsdom
import { MarkeeAdvertisement } from "@/app/MarkeeAdvertisement";
import { MARKEE_ADMIN } from "@/lib/markee";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, account, card } = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  account: { address: undefined as string | undefined, isConnected: false },
  card: { client: undefined as unknown, rentLoaded: vi.fn() },
}));
vi.mock("@/hooks/useMarkee", () => {
  card.rentLoaded();
  return { useMarkee: () => state.current };
});
vi.mock("wagmi", () => ({ useAccount: () => account, usePublicClient: () => card.client }));
vi.mock("@/lib/markee", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readMarkeeBoard: async () => ({ message: "Read by the card" }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    type?: "button" | "submit";
  }) => (
    <button disabled={disabled} type={type}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/WalletButton", () => ({
  WalletConnectButton: ({ label }: { label: string }) => <button>{label}</button>,
}));

beforeEach(() => {
  account.address = MARKEE_ADMIN;
  account.isConnected = true;
  state.current = {
    boardAddress: undefined,
    board: undefined,
    wallet: undefined,
    loading: false,
    busy: false,
    pending: false,
    canCreateBoard: true,
    createBoard: vi.fn(),
    takeover: vi.fn(),
    stop: vi.fn(),
    withdraw: vi.fn(),
    recover: vi.fn(),
    refresh: vi.fn(),
    quoteFunding: vi.fn(() => ({ buffer: 100n, depositTopUp: 100n, wrapValue: 1000n })),
  };
});
afterEach(cleanup);
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Take over this advertisement" }));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
};

describe("real Markee advertisement", () => {
  it("shows the board from its own read and loads the rent dialog only when opened", async () => {
    card.client = {};
    render(
      <MarkeeAdvertisement initialBoardAddress="0x1111111111111111111111111111111111111111" />,
    );
    expect(await screen.findByText("Read by the card")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(card.rentLoaded).not.toHaveBeenCalled();
    await open();
    expect(screen.getByRole("dialog", { name: "Rent this space" })).toBeTruthy();
    card.client = undefined;
  });

  it("requires verified board setup and keeps Preview secondary without submitting a stream", async () => {
    render(<MarkeeAdvertisement />);
    await open();
    expect(
      screen.getByText("This advertisement needs to be set up before it can accept streams."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your message"), {
      target: { value: "My new message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("My new message", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take over" }).hasAttribute("disabled")).toBe(true);
    expect(state.current.takeover).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("region", { name: "Markee advertisement" })).getByText(
        "Your message could be here.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create advertisement" }));
    expect(state.current.createBoard).toHaveBeenCalledOnce();
  });

  it("submits Take over through the owning hook while Preview never replaces onchain content", async () => {
    state.current = {
      ...state.current,
      boardAddress: "0x1111111111111111111111111111111111111111",
      board: {
        message: "Live onchain message",
        minimumMonthlyRate: 999999997884000n,
        maxMessageLength: 222n,
        effectiveTopRate: 0n,
      },
      wallet: { flowRate: 0n, deposit: 0n },
      canCreateBoard: false,
    };
    render(<MarkeeAdvertisement />);
    await open();
    fireEvent.change(screen.getByLabelText("Your message"), {
      target: { value: "New funded message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Live onchain message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(state.current.takeover).toHaveBeenCalledExactlyOnceWith("New funded message", "0.001");
    expect(screen.queryByText("Example rate")).toBeNull();
    expect(screen.queryByText(/This demo/)).toBeNull();
  });

  it("blocks a new Take over while an existing stream is active and exposes cancellation", async () => {
    state.current = {
      ...state.current,
      boardAddress: "0x1111111111111111111111111111111111111111",
      board: {
        message: "Live",
        minimumMonthlyRate: 999999997884000n,
        maxMessageLength: 222n,
        effectiveTopRate: 100n,
      },
      wallet: { flowRate: 100n, deposit: 100n },
      canCreateBoard: false,
    };
    render(<MarkeeAdvertisement />);
    await open();
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Another" } });
    expect(screen.getByRole("button", { name: "Take over" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop stream" }));
    expect(state.current.stop).toHaveBeenCalledOnce();
  });

  it("retains recovery and disables fresh payment while a saved transaction is pending", async () => {
    state.current = { ...state.current, pending: true, error: "Confirmation unavailable." };
    render(<MarkeeAdvertisement />);
    await open();
    expect(screen.getByRole("alert").textContent).toBe("Confirmation unavailable.");
    expect(
      screen.getByRole("button", { name: "Create advertisement" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check existing transaction" }));
    expect(state.current.recover).toHaveBeenCalledOnce();
  });
});
