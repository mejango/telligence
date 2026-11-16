import {
  assertRecoveryStep,
  ProjectRecoveryControls,
} from "@/components/telligence/ProjectRecoveryControls";
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
  /** What the reviewed run resolves with. */
  result: null as unknown,
  /** What changes onchain while the review is open. */
  duringReview: undefined as undefined | (() => void),
  /** The action the component last ran. */
  action: undefined as
    undefined | { reverify?: (call: unknown, step: number) => Promise<void>; calls: unknown[] },
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.account, isConnected: true }) }));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: (chainId: number) => {
    if (chainId !== 8453) throw new Error("Base only");
    return { readContract: mocks.readContract, getBlock: mocks.getBlock };
  },
}));
vi.mock("@/hooks/useReviewedAction", () => {
  class ReviewRefusal extends Error {}
  return {
    ReviewRefusal,
    SAFE_PROPOSAL_PENDING_LINE: "This proposal is waiting in your Safe. Finish it there first.",
    failedLine: (result: { error: string }) => result.error,
    // The request itself stands for its reviewed call.
    reviewedCall: (request: unknown) => request,
    useReviewedAction: () => ({
      run: async (action: NonNullable<typeof mocks.action>) => {
        mocks.action = action;
        mocks.duringReview?.();
        try {
          await action.reverify?.(action.calls[0], 0);
        } catch (error) {
          return { status: "failed", error: (error as Error).message, failure: error };
        }
        mocks.write(action.calls[0]);
        return mocks.result;
      },
    }),
  };
});
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
const props = { revnetId: 42n, policyAddress: policy, vaultAddress: vault } as const;
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
  mocks.result = { status: "done", hashes: [HASH], receipts: [{}] };
  mocks.action = undefined;
  mocks.duringReview = undefined;
  mocks.write.mockReset();
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
});

describe("project recovery", () => {
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
      assertRecoveryStep(
        props,
        { functionName: "setAuthenticationEnabled", args: [false] },
        mocks.account,
      ),
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
    await waitFor(() => expect(mocks.write).toHaveBeenCalled());
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
    // Authority moves while the review is open: the submitted step is refused, nothing is sent.
    mocks.duringReview = () => {
      values.CREATOR = "0x9999999999999999999999999999999999999999";
    };
    fireEvent.click(await screen.findByRole("button", { name: "Disable API authentication" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/authority|creator|recovery/i);
    expect(mocks.write).not.toHaveBeenCalled();
    values.CREATOR = creator;
    values.authenticationEnabled = false;
    await expect(
      assertRecoveryStep(
        props,
        { functionName: "setAuthenticationEnabled", args: [false] },
        creator,
      ),
    ).rejects.toThrow(/already disabled|authentication.*changed/i);
  });

  it.each([[true], [], [false, true]])(
    "rejects authentication arguments %j outside emergency disable",
    async (...args) => {
      mount();
      await screen.findByRole("button", { name: "Disable API authentication" });
      await expect(
        assertRecoveryStep(props, { functionName: "setAuthenticationEnabled", args }, creator),
      ).rejects.toThrow(/only.*disable|invalid.*authentication/i);
    },
  );

  it("does not report authentication disabled before a Safe proposal executes", async () => {
    mocks.result = { status: "proposed", step: 0, safeTxHash: HASH };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Disable API authentication" }));
    expect(await screen.findByText(/waiting in your Safe/)).toBeInTheDocument();
    expect(screen.getByText("API authentication: Enabled")).toBeInTheDocument();
    expect(screen.queryByText("API authentication: Disabled")).not.toBeInTheDocument();
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

  it("wallet-action:telligence-recovery keeps closure irreversible and bound to its own policy", async () => {
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
    mocks.duringReview = () => {
      values.CREATOR = "0x9999999999999999999999999999999999999999";
    };
    fireEvent.click(await screen.findByRole("button", { name: "Announce closure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/authority|creator|recovery/i);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps a Safe proposal pending instead of claiming successful recovery", async () => {
    mocks.result = { status: "proposed", step: 0, safeTxHash: HASH };
    mount();
    // Receipt state is only visible for this component's submitted hash.
    fireEvent.click(await screen.findByRole("button", { name: "Announce closure" }));
    expect(await screen.findByText(/waiting in your Safe/)).toBeInTheDocument();
    expect(screen.queryByText("Confirmed on Base.")).not.toBeInTheDocument();
  });

  it("cancels a review when its recovery component has been unmounted", async () => {
    const { unmount } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Announce closure" }));
    await waitFor(() => expect(mocks.action).toBeDefined());
    const { reverify, calls } = mocks.action!;
    unmount();
    await expect(reverify?.(calls[0], 0)).rejects.toThrow(/project changed/i);
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
    mocks.duringReview = () => {
      values.stakedInfos = [0n, NOW + 100n, 1n];
    };
    fireEvent.click(await screen.findByRole("button", { name: "Release backing" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not ready/i);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
