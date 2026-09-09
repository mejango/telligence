import { ProjectRecoveryControls } from "@/components/telligence/ProjectRecoveryControls";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: "0x1111111111111111111111111111111111111111" as Address,
  readContract: vi.fn(),
  getBlock: vi.fn(),
  write: vi.fn(),
  reverify: undefined as
    | undefined
    | ((
        variables: { functionName: string; args?: readonly unknown[] },
        account: Address,
      ) => Promise<void>),
  receipt: {
    isLoading: false,
    isSuccess: false,
    isError: false,
    isSafeProposal: false,
    statusMessage: undefined as string | undefined,
  },
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.account, isConnected: true }) }));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: (chainId: number) => {
    if (chainId !== 8453) throw new Error("Base only");
    return { readContract: mocks.readContract, getBlock: mocks.getBlock };
  },
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: (options: { reverify?: typeof mocks.reverify }) => {
    mocks.reverify = options.reverify;
    return { writeContractAsync: mocks.write, isPending: false };
  },
  useWaitForTransactionReceipt: () => mocks.receipt,
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({ children, disabled, onClick }: ComponentProps<"button">) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

const creator = "0x1111111111111111111111111111111111111111" as const;
const recovery = "0x2222222222222222222222222222222222222222" as const;
const policy = "0x3333333333333333333333333333333333333333" as const;
const vault = "0x4444444444444444444444444444444444444444" as const;
const staking = "0x321b7ff75154472B18EDb199033fF4D116F340Ff" as const;
const diem = "0xf4D97F2da56E8C3098F3a8d538DB630A2606A024" as const;
const vvv = "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf" as const;
const NOW = 1_800_000_000n;
const HASH = `0x${"a".repeat(64)}` as const;
let values: Record<string, unknown>;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectRecoveryControls revnetId={42n} policyAddress={policy} vaultAddress={vault} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.account = creator;
  mocks.receipt = {
    isLoading: false,
    isSuccess: false,
    isError: false,
    isSafeProposal: false,
    statusMessage: undefined,
  };
  vi.spyOn(Date, "now").mockReturnValue(Number(NOW) * 1000);
  values = {
    CREATOR: creator,
    RECOVERY: recovery,
    revnetId: 42n,
    vault,
    POLICY: policy,
    VVV: vvv,
    STAKING: staking,
    DIEM: diem,
    state: 0,
    noticeEndsAt: 0n,
    WINDDOWN_NOTICE: 604800n,
    allocationPaused: false,
    windingDown: false,
    authenticationEnabled: true,
    signerGeneration: 7n,
    stakedInfos: [1n, 0n, 0n],
    stakes: [0n, 0n, 0n],
  };
  mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: NOW });
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
    return values[functionName];
  });
  mocks.write.mockImplementation(
    async (variables: { functionName: string; args?: readonly unknown[] }) => {
      await mocks.reverify?.(variables, mocks.account);
      return HASH;
    },
  );
});

describe("wallet-action:telligence-recovery project recovery", () => {
  it.each([creator, recovery])(
    "lets authorized wallet %s disable authentication through its fixed policy",
    async (account) => {
      mocks.account = account;
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Disable API authentication" }));
      await waitFor(() =>
        expect(mocks.write).toHaveBeenCalledWith(
          expect.objectContaining({
            chainId: 8453,
            address: policy,
            functionName: "setAuthenticationEnabled",
            args: [false],
          }),
        ),
      );
      expect(screen.getByText("API authentication: Enabled")).toBeInTheDocument();
      expect(screen.getByText("Credential generation: 7")).toBeInTheDocument();
      expect(screen.getByText(/does not move.*backing/i)).toBeInTheDocument();
      expect(screen.getByText(/provider.*separately verified/i)).toBeInTheDocument();
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: vault,
          functionName: "signerGeneration",
          blockNumber: 123n,
        }),
      );
    },
  );

  it("does not expose authentication changes to an unrelated wallet", async () => {
    mocks.account = "0x9999999999999999999999999999999999999999";
    mount();
    await screen.findByText("API authentication: Enabled");
    expect(screen.queryByRole("button", { name: /API authentication/ })).not.toBeInTheDocument();
    await expect(
      mocks.reverify?.({ functionName: "setAuthenticationEnabled", args: [false] }, mocks.account),
    ).rejects.toThrow(/authority|creator|recovery/i);
  });

  it("shows disabled authentication without offering an enable or signer replacement action", async () => {
    values.authenticationEnabled = false;
    values.signerGeneration = 8n;
    mount();
    await screen.findByText("API authentication: Disabled");
    expect(screen.getByText("Credential generation: 8")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /API authentication/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps emergency authentication disable available during the closure notice", async () => {
    values.state = 1;
    values.windingDown = true;
    values.noticeEndsAt = NOW + 604800n;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Disable API authentication" }));
    await waitFor(() => expect(mocks.write).toHaveResolvedWith(HASH));
    expect(screen.getByRole("button", { name: "Start compute withdrawal" })).toBeDisabled();
  });

  it("does not suggest restoring authentication after withdrawal permanently disables it", async () => {
    values.state = 2;
    values.windingDown = true;
    values.authenticationEnabled = false;
    mount();
    await screen.findByText("API authentication: Disabled");
    expect(screen.getByText(/authentication is permanently disabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/restoring access requires/i)).not.toBeInTheDocument();
  });

  it("rechecks authentication and authority after review before disabling", async () => {
    mount();
    await screen.findByRole("button", { name: "Disable API authentication" });
    values.CREATOR = "0x9999999999999999999999999999999999999999";
    await expect(
      mocks.reverify?.({ functionName: "setAuthenticationEnabled", args: [false] }, creator),
    ).rejects.toThrow(/authority|creator|recovery/i);
    values.CREATOR = creator;
    values.authenticationEnabled = false;
    await expect(
      mocks.reverify?.({ functionName: "setAuthenticationEnabled", args: [false] }, creator),
    ).rejects.toThrow(/already disabled|authentication.*changed/i);
  });

  it.each([[true], [], [false, true]])(
    "rejects authentication arguments %j outside emergency disable",
    async (...args) => {
      mount();
      await screen.findByRole("button", { name: "Disable API authentication" });
      await expect(
        mocks.reverify?.({ functionName: "setAuthenticationEnabled", args }, creator),
      ).rejects.toThrow(/only.*disable|invalid.*authentication/i);
    },
  );

  it("does not report authentication disabled before a Safe proposal executes", async () => {
    mocks.receipt.isSafeProposal = true;
    mocks.receipt.isLoading = true;
    mocks.receipt.statusMessage = "Safe proposal submitted. Awaiting approvals and execution.";
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Disable API authentication" }));
    expect(await screen.findByText(/Safe proposal submitted/)).toBeInTheDocument();
    expect(screen.getByText("API authentication: Enabled")).toBeInTheDocument();
    expect(screen.queryByText("API authentication: Disabled")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable API authentication" })).toBeDisabled();
  });

  it("offers only onchain creator or recovery authority the pause and closure controls", async () => {
    mount();
    await screen.findByRole("button", { name: "Pause new allocations" });
    expect(screen.getByRole("button", { name: "Announce closure" })).toBeEnabled();
    expect(screen.getByText(/7 days.*notice/i)).toBeInTheDocument();
    expect(
      screen.getByText(/original contributors are not individually refunded/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause new allocations" }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 8453,
          address: policy,
          functionName: "setAllocationPaused",
          args: [true],
        }),
      ),
    );
  });

  it("does not expose privileged actions to an unrelated wallet", async () => {
    mocks.account = "0x9999999999999999999999999999999999999999";
    mount();
    await screen.findByText(/only.*creator or recovery wallet/i);
    expect(screen.queryByRole("button", { name: "Announce closure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause new allocations" })).not.toBeInTheDocument();
  });

  it("lets the recovery wallet resume paused allocations", async () => {
    mocks.account = recovery;
    values.allocationPaused = true;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Resume new allocations" }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "setAllocationPaused", args: [false] }),
      ),
    );
  });

  it("keeps closure irreversible and bound to its own policy", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Announce closure" }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 8453,
          address: policy,
          functionName: "announceWinddown",
          args: [],
        }),
      ),
    );
    expect(screen.getByText(/irreversible/i)).toBeInTheDocument();
  });

  it("waits for the actual onchain notice deadline before enabling permissionless recovery", async () => {
    values.state = 1;
    values.windingDown = true;
    values.noticeEndsAt = NOW + 3600n;
    mount();
    expect(await screen.findByRole("button", { name: "Start compute withdrawal" })).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("lets any wallet begin withdrawal once the notice matures", async () => {
    mocks.account = "0x9999999999999999999999999999999999999999";
    values.state = 1;
    values.windingDown = true;
    values.noticeEndsAt = NOW;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start compute withdrawal" }));
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          address: vault,
          functionName: "beginDiemUnstake",
          chainId: 8453,
          args: [],
        }),
      ),
    );
  });

  it.each([
    {
      state: 2,
      property: "stakedInfos",
      label: "Release backing",
      method: "claimDiemAndBeginVVVUnstake",
    },
    {
      state: 3,
      property: "stakes",
      label: "Return backing to revnet",
      method: "claimVVVAndReturn",
    },
  ])(
    "uses the live provider cooldown for state $state",
    async ({ state, property, label, method }) => {
      values.state = state;
      values.windingDown = true;
      values[property] = [0n, NOW + 1n, 1n];
      const { unmount } = mount();
      expect(await screen.findByRole("button", { name: label })).toBeDisabled();
      unmount();
      values[property] = [0n, NOW, 1n];
      mount();
      fireEvent.click(await screen.findByRole("button", { name: label }));
      await waitFor(() =>
        expect(mocks.write).toHaveBeenCalledWith(
          expect.objectContaining({ address: vault, functionName: method, chainId: 8453 }),
        ),
      );
    },
  );

  it("fails closed when the policy and vault binding does not match", async () => {
    values.revnetId = 43n;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/binding/i);
    expect(screen.queryByRole("button", { name: "Announce closure" })).not.toBeInTheDocument();
  });

  it("refuses stale Base RPC data before exposing a wallet action", async () => {
    mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: NOW - 600n });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/stale/i);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rechecks the role and state after review before signing", async () => {
    mount();
    await screen.findByRole("button", { name: "Announce closure" });
    values.CREATOR = "0x9999999999999999999999999999999999999999";
    await expect(
      mocks.reverify?.({ functionName: "announceWinddown", args: [] }, creator),
    ).rejects.toThrow(/authority|creator|recovery/i);
  });

  it("keeps a Safe proposal pending instead of claiming successful recovery", async () => {
    mocks.receipt.isSafeProposal = true;
    mocks.receipt.isLoading = true;
    mocks.receipt.statusMessage = "Safe proposal submitted. Awaiting approvals and execution.";
    mount();
    // Receipt state is only visible for this component's submitted hash.
    fireEvent.click(await screen.findByRole("button", { name: "Announce closure" }));
    expect(await screen.findByText(/Safe proposal submitted/)).toBeInTheDocument();
    expect(screen.queryByText("Confirmed on Base.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Announce closure" })).toBeDisabled();
  });

  it("cancels a review when its recovery component has been unmounted", async () => {
    const { unmount } = mount();
    await screen.findByRole("button", { name: "Announce closure" });
    const reverify = mocks.reverify;
    unmount();
    await expect(
      reverify?.({ functionName: "announceWinddown", args: [] }, creator),
    ).rejects.toThrow(/project changed/i);
  });

  it("keeps an unexpectedly long provider deadline readable and blocked", async () => {
    values.state = 3;
    values.windingDown = true;
    values.stakes = [0n, 2n ** 255n, 1n];
    mount();
    expect(await screen.findByRole("button", { name: "Return backing to revnet" })).toBeDisabled();
    expect(screen.getByText(/beyond the supported calendar range/i)).toBeInTheDocument();
  });

  it("rechecks provider cooldown readiness after the transaction review", async () => {
    values.state = 2;
    values.windingDown = true;
    values.stakedInfos = [0n, NOW, 1n];
    mount();
    await screen.findByRole("button", { name: "Release backing" });
    values.stakedInfos = [0n, NOW + 100n, 1n];
    await expect(
      mocks.reverify?.({ functionName: "claimDiemAndBeginVVVUnstake", args: [] }, creator),
    ).rejects.toThrow(/not ready/i);
  });
});
