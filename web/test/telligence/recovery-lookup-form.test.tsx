import { RecoveryLookup } from "@/components/telligence/RecoveryLookup";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  http: vi.fn((url: string, options: unknown) => ({ url, options })),
  lookup: vi.fn(),
}));
vi.mock("viem", async () => ({
  ...(await vi.importActual<typeof import("viem")>("viem")),
  createPublicClient: mocks.createPublicClient,
  http: mocks.http,
}));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ kind: "site-default" }),
}));
vi.mock("@/lib/telligence/recovery-lookup", async () => ({
  ...(await vi.importActual<typeof import("@/lib/telligence/recovery-lookup")>(
    "@/lib/telligence/recovery-lookup",
  )),
  lookupRecoveryProject: mocks.lookup,
}));
vi.mock("@/components/telligence/ProjectRecoveryControls", () => ({
  ProjectRecoveryControls: () => <div>controls</div>,
}));

const factory = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS", factory);
  mocks.createPublicClient.mockReturnValue({ kind: "own-rpc" });
  mocks.lookup.mockResolvedValue({
    revnetId: 12n,
    factoryAddress: factory,
    policyAddress: "0x2222222222222222222222222222222222222222",
    vaultAddress: "0x3333333333333333333333333333333333333333",
    creatorAddress: "0x4444444444444444444444444444444444444444",
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("gateway-independent recovery form", () => {
  it("shows the pinned factory so it can be verified independently", () => {
    render(<RecoveryLookup />);
    expect(screen.getByRole("link", { name: factory })).toHaveAttribute(
      "href",
      `https://basescan.org/address/${factory}`,
    );
  });

  it("reads through the user's own https RPC only when one is given", async () => {
    render(<RecoveryLookup initialProjectId="12" />);
    fireEvent.click(screen.getByRole("button", { name: /Look up recovery/ }));
    await screen.findByText("Base project 12");
    expect(mocks.lookup).toHaveBeenLastCalledWith({ kind: "site-default" }, factory, 12n);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Base RPC URL (optional)"), {
      target: { value: "https://rpc.example/base" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Look up recovery/ }));
    await screen.findByText("Base project 12");
    expect(mocks.http).toHaveBeenCalledWith("https://rpc.example/base", {
      retryCount: 0,
      timeout: 10_000,
    });
    expect(mocks.createPublicClient).toHaveBeenCalledWith(
      expect.objectContaining({ chain: expect.objectContaining({ id: 8453 }) }),
    );
    expect(mocks.lookup).toHaveBeenLastCalledWith({ kind: "own-rpc" }, factory, 12n);
  });

  it("refuses an insecure RPC URL before reading anything", async () => {
    render(<RecoveryLookup initialProjectId="12" />);
    fireEvent.change(screen.getByLabelText("Base RPC URL (optional)"), {
      target: { value: "http://rpc.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Look up recovery/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/https/);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });
});
