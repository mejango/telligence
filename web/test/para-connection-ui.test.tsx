import { ParaConnectionBridge } from "@/app/AppSpecificProviders";
import { ParaConnectionNotice } from "@/providers/ParaConnectionNotice";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  connect: vi.fn(),
  connectAsync: vi.fn(),
}));

vi.mock("@/components/TransactionReviewProvider", () => ({
  TransactionReviewProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/browserEnvironment", () => ({
  IS_DETERMINISTIC_BROWSER: false,
  PARA_EMBEDDED_WALLET_ENABLED: true,
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/providers/para-bridge", () => ({
  connectParaSession: bridge.connect,
}));
vi.mock("@/providers/para-session", () => ({
  verifyMarkedParaSession: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false }),
  useConnect: () => ({ connectAsync: bridge.connectAsync }),
  useConnectors: () => [{ id: "para", uid: "para" }],
  WagmiProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("Para connection recovery UI", () => {
  it("surfaces a sanitized bridge failure", async () => {
    bridge.connect.mockRejectedValueOnce(new Error("sensitive provider detail"));
    const onConnected = vi.fn();
    const onError = vi.fn();

    render(
      <ParaConnectionBridge
        modalOpen={false}
        onConnected={onConnected}
        onError={onError}
        sessionVersion={1}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("offers explicit retry and dismiss actions without exposing provider details", () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    render(<ParaConnectionNotice onDismiss={onDismiss} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Telligence could not finish connecting your embedded wallet",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("sensitive provider detail");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
