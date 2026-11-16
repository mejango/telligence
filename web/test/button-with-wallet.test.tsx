import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isConnected: false, requestSignIn: vi.fn() }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: mocks.isConnected }),
  useChainId: () => 1,
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/nana/project", () => ({ useJBChainId: () => 1 }));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/WalletButton", () => ({
  WalletConnectButton: ({ label, ...props }: { label: string; disabled?: boolean }) => (
    <button {...props} data-testid="connect" onClick={mocks.requestSignIn}>
      {label}
    </button>
  ),
}));

describe("ButtonWithWallet", () => {
  beforeEach(() => {
    mocks.isConnected = false;
    mocks.requestSignIn.mockClear();
  });

  it("keeps the form's disabled state by default", () => {
    render(<ButtonWithWallet disabled>Take over</ButtonWithWallet>);
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeDisabled();
  });

  it("keeps Connect Wallet clickable in the dialogs that ask for it", () => {
    render(
      <ButtonWithWallet connectWhileDisabled disabled loading>
        Cash out
      </ButtonWithWallet>,
    );
    const connect = screen.getByRole("button", { name: "Connect Wallet" });
    expect(connect).toBeEnabled();
    expect(connect).not.toHaveAttribute("loading");
    fireEvent.click(connect);
    expect(mocks.requestSignIn).toHaveBeenCalledOnce();
  });

  it("still disables the action once connected", () => {
    mocks.isConnected = true;
    render(<ButtonWithWallet disabled>Cash out</ButtonWithWallet>);
    expect(screen.getByRole("button", { name: "Cash out" })).toBeDisabled();
  });
});
