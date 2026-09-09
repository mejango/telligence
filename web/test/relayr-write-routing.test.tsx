import type { ChainWrite } from "@/app/[slug]/components/v6/operator/operatorLib";
import type { ChainFormData } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import type { ChainPayment } from "@/lib/nana/types";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { act, renderHook } from "@testing-library/react";
import { parseAbi, zeroAddress, type Address, type Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {},
  chainId: 8453,
  safe: false,
  receiptSuccess: false,
  lastSubmittedHash: undefined as Hash | undefined,
  writeContractAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  estimateContractGas: vi.fn(),
  getRelayrTxQuote: vi.fn(),
  requireRelayrRecoveryScopeAvailable: vi.fn(),
  sendRelayrTx: vi.fn(),
  waitForRelayrBundle: vi.fn(),
  resetRelayr: vi.fn(),
  chooseRelayrPayment: vi.fn(),
  runSequentialWrites: vi.fn(),
  contractAddress: vi.fn(),
  readAuthorityIdentity: vi.fn(),
  operatorWriteRoute: vi.fn(),
  listPendingSafeTransactions: vi.fn(),
  toast: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TARGET = "0x2222222222222222222222222222222222222222" as Address;
const FIRST_HASH = `0x${"aa".repeat(32)}` as Hash;
const LAST_HASH = `0x${"bb".repeat(32)}` as Hash;
const ABI = parseAbi(["function setHookFor(uint256 value)"]);
const PAYMENTS: ChainPayment[] = [
  {
    chain: 1,
    amount: "0x10",
    target: TARGET,
    calldata: "0x1234",
    token: zeroAddress,
    payment_deadline: "2030-01-01T00:00:00Z",
  },
  {
    chain: 10,
    amount: "0x20",
    target: TARGET,
    calldata: "0xabcd",
    token: zeroAddress,
    payment_deadline: "2030-01-01T00:00:00Z",
  },
];
const QUOTE = { bundle_uuid: "selected-payment-bundle", payment_info: PAYMENTS };
const RELAYR_NETWORKS: { family: string; chains: JBChainId[]; preferred: JBChainId }[] = [
  { family: "mainnets", chains: [1, 10, 8453, 42161], preferred: 8453 },
  { family: "testnets", chains: [11155111, 11155420, 84532, 421614], preferred: 84532 },
];

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useAccount: () => ({ address: ACCOUNT, chainId: mocks.chainId }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: ACCOUNT, chainId: mocks.chainId }),
  getPublicClient: () => ({ estimateContractGas: mocks.estimateContractGas }),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: mocks.config }));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  requireRelayrRecoveryScopeAvailable: mocks.requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote: () => ({
    getRelayrTxQuote: mocks.getRelayrTxQuote,
    reset: mocks.resetRelayr,
  }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.sendRelayrTx }),
  waitForRelayrBundle: mocks.waitForRelayrBundle,
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: () => ({
    writeContractAsync: mocks.writeContractAsync,
    data: mocks.lastSubmittedHash,
    isPending: false,
  }),
  useWaitForTransactionReceipt: ({ hash }: { hash?: Hash }) => ({
    isSuccess: Boolean(hash) && mocks.receiptSuccess,
    isLoading: false,
  }),
  isSafeConnection: () => mocks.safe,
  submittedViaSafe: () => false,
}));
vi.mock("@/lib/transaction-review", () => ({
  chooseRelayrPayment: mocks.chooseRelayrPayment,
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", () => ({
  runSequentialWrites: mocks.runSequentialWrites,
  chainName: (chainId: number) => `Chain ${chainId}`,
  publicClientFor: () => ({ estimateContractGas: mocks.estimateContractGas }),
  operatorWriteRoute: mocks.operatorWriteRoute,
}));
vi.mock("@/lib/cross-chain-authority", () => ({
  readAuthorityIdentity: mocks.readAuthorityIdentity,
  readBoundedSafeNonce: vi.fn(),
}));
vi.mock("@/lib/safe-queue", () => ({
  listPendingSafeTransactions: mocks.listPendingSafeTransactions,
  nextProposalNonce: vi.fn(),
  proposeSafeTransaction: vi.fn(),
  queuedTransactionMatchesCall: vi.fn(),
  safeProposalFor: vi.fn(),
  submitSafeConfirmation: vi.fn(),
}));
vi.mock("@/hooks/useReviewedSafeSignature", () => ({
  useReviewedSafeSignature: () => ({ signSafeTransactionAsync: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({ contractAddress: mocks.contractAddress }),
}));
vi.mock("@/app/constants", () => ({ RESERVED_TOKEN_SPLIT_GROUP_ID: 1 }));

import { useOperatorWrites } from "@/app/[slug]/components/v6/operator/useOperatorWrites";
import { useSetSplitGroups } from "@/app/[slug]/owners/components/hooks/useSetSplitGroups";

function operatorWrites(chainIds: number[]): ChainWrite[] {
  return chainIds.map((chainId) => ({
    chainId: chainId as JBChainId,
    address: TARGET,
    abi: ABI,
    functionName: "setHookFor",
    args: [42n],
  }));
}

function splitChains(chainIds: number[]): ChainFormData[] {
  return chainIds.map((chainId) => ({
    chainId: chainId as JBChainId,
    projectId: BigInt(chainId),
    rulesetId: 123n,
    selected: true,
    splits: [{ percentage: "100", beneficiary: ACCOUNT }],
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.requireRelayrRecoveryScopeAvailable.mockImplementation(() => undefined);
  mocks.chainId = 8453;
  mocks.safe = false;
  mocks.receiptSuccess = false;
  mocks.lastSubmittedHash = undefined;
  mocks.contractAddress.mockReturnValue(TARGET);
  mocks.estimateContractGas.mockResolvedValue(100_000n);
  mocks.getRelayrTxQuote.mockResolvedValue(QUOTE);
  mocks.chooseRelayrPayment.mockResolvedValue(PAYMENTS[1]);
  mocks.sendRelayrTx.mockResolvedValue(LAST_HASH);
  mocks.waitForRelayrBundle.mockResolvedValue(undefined);
  mocks.writeContractAsync.mockImplementation(async () => {
    mocks.lastSubmittedHash = LAST_HASH;
    return LAST_HASH;
  });
  mocks.runSequentialWrites.mockImplementation(async ({ writes, writeContractAsync }) => {
    for (const write of writes) await writeContractAsync(write);
    return writes.length;
  });
});

describe("wallet-action:operator-writes — operator Relayr routing", () => {
  const run = (runWrites: ReturnType<typeof useOperatorWrites>["runWrites"], chains: number[]) =>
    runWrites({
      writes: operatorWrites(chains),
      account: ACCOUNT,
      label: "Update",
      onProgress: vi.fn(),
    });

  it.each([
    { label: "a single chain", chains: [1], safe: false },
    { label: "mixed mainnets and testnets", chains: [1, 11155111], safe: false },
    { label: "an unsupported chain", chains: [1, 137], safe: false },
    { label: "a Safe connection", chains: [1, 10], safe: true },
    { label: "a testnet Safe connection", chains: [11155111, 84532], safe: true },
  ])("uses sequential reviewed writes for $label", async ({ chains, safe }) => {
    mocks.safe = safe;
    const { result } = renderHook(useOperatorWrites);
    await expect(run(result.current.runWrites, chains)).resolves.toMatchObject({
      chains: chains.length,
      viaRelayr: false,
    });
    expect(mocks.runSequentialWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        writes: operatorWrites(chains),
      }),
    );
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.chooseRelayrPayment).not.toHaveBeenCalled();
  });

  it.each(RELAYR_NETWORKS)(
    "waits for explicit funding selection across supported $family and preserves the initial wallet preference",
    async ({ chains, preferred }) => {
      mocks.chainId = preferred;
      const payments = PAYMENTS.map((payment, index) => ({ ...payment, chain: chains[index] }));
      const selected = deferred<(typeof PAYMENTS)[number]>();
      mocks.chooseRelayrPayment.mockReturnValue(selected.promise);
      mocks.getRelayrTxQuote.mockImplementation(async () => {
        // Authorization may switch networks before payment selection opens.
        mocks.chainId = chains[3];
        return { ...QUOTE, payment_info: payments };
      });
      const { result } = renderHook(useOperatorWrites);
      const pending = run(result.current.runWrites, chains);
      await vi.waitFor(() =>
        expect(mocks.chooseRelayrPayment).toHaveBeenCalledWith(payments, preferred),
      );
      expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
      expect(
        mocks.getRelayrTxQuote.mock.calls[0][0].map((call: { chainId: number }) => call.chainId),
      ).toEqual(chains);

      selected.resolve(payments[1]);
      await expect(pending).resolves.toMatchObject({ chains: 4, viaRelayr: true });
      expect(mocks.sendRelayrTx).toHaveBeenCalledExactlyOnceWith(payments[1]);
      expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith(QUOTE.bundle_uuid);
      expect(mocks.runSequentialWrites).not.toHaveBeenCalled();
    },
  );

  it("stops before payment when funding selection is cancelled", async () => {
    mocks.chooseRelayrPayment.mockRejectedValue(new Error("Transaction review cancelled"));
    const { result } = renderHook(useOperatorWrites);
    await expect(run(result.current.runWrites, [1, 10])).rejects.toThrow(/cancelled/);
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
    expect(mocks.waitForRelayrBundle).not.toHaveBeenCalled();
  });

  it.each([
    { functionName: "initializePoolFor", chains: [1, 11155111], safe: false, safeSigner: false },
    { functionName: "deploySuckersFor", chains: [1, 11155111], safe: false, safeSigner: false },
    { functionName: "setOperatorOf", chains: [1, 11155111], safe: false, safeSigner: false },
    { functionName: "deploySuckersFor", chains: [1, 10], safe: true, safeSigner: false },
    { functionName: "deploySuckersFor", chains: [11155111, 84532], safe: true, safeSigner: false },
    { functionName: "setOperatorOf", chains: [1, 10], safe: false, safeSigner: true },
  ])(
    "blocks partial $functionName batches before any wallet action",
    async ({ functionName, chains, safe, safeSigner }) => {
      mocks.safe = safe;
      mocks.operatorWriteRoute.mockReturnValue({
        kind: "safe-signer",
        safe: TARGET,
        owners: [ACCOUNT],
        threshold: 1,
      });
      const { result } = renderHook(useOperatorWrites);
      await expect(
        result.current.runWrites({
          writes: operatorWrites(chains).map((write) => ({
            ...write,
            functionName,
            authority: safeSigner ? TARGET : undefined,
          })),
          account: ACCOUNT,
          label: "Initialize",
          onProgress: vi.fn(),
        }),
      ).rejects.toThrow("Choose one chain");
      expect(mocks.runSequentialWrites).not.toHaveBeenCalled();
      expect(mocks.writeContractAsync).not.toHaveBeenCalled();
      expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
      expect(mocks.listPendingSafeTransactions).not.toHaveBeenCalled();
    },
  );

  it.each([
    { functionName: "initializePoolFor", chains: [1, 10] },
    { functionName: "initializePoolFor", chains: [11155111, 84532] },
    { functionName: "deploySuckersFor", chains: [11155111, 84532] },
    { functionName: "setOperatorOf", chains: [11155111, 84532] },
  ])("relays same-family EOA $functionName on $chains", async ({ functionName, chains }) => {
    const { result } = renderHook(useOperatorWrites);
    await expect(
      result.current.runWrites({
        writes: operatorWrites(chains).map((write) => ({
          ...write,
          functionName,
          abi: parseAbi([`function ${functionName}(uint256 value)`]),
        })),
        account: ACCOUNT,
        label: "Initialize pool",
        onProgress: vi.fn(),
      }),
    ).resolves.toMatchObject({ chains: 2, viaRelayr: true });
    expect(mocks.getRelayrTxQuote).toHaveBeenCalledOnce();
    expect(mocks.runSequentialWrites).not.toHaveBeenCalled();
  });
});

describe("wallet-action:split-groups — reserved token split routing", () => {
  it("does not bypass an unresolved split relay by selecting a single chain", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.requireRelayrRecoveryScopeAvailable.mockImplementation(() => {
      throw new Error("Previous relay requires reconciliation");
    });
    const { result } = renderHook(() => useSetSplitGroups({ onSuccess: vi.fn() }));
    await act(async () => {
      await expect(result.current.submitSplits(splitChains([10]))).resolves.toEqual({
        success: false,
      });
    });
    expect(mocks.requireRelayrRecoveryScopeAvailable).toHaveBeenCalledWith(
      ACCOUNT,
      "project-splits:10:10:123:1",
    );
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.switchChainAsync).not.toHaveBeenCalled();
  });

  it("writes a single chain directly and reports success only after its receipt", async () => {
    const onSuccess = vi.fn();
    const { result, rerender } = renderHook(() => useSetSplitGroups({ onSuccess }));
    await act(async () => {
      await expect(result.current.submitSplits(splitChains([10]))).resolves.toEqual({
        success: true,
      });
    });
    expect(mocks.switchChainAsync).toHaveBeenCalledWith({ chainId: 10 });
    expect(mocks.writeContractAsync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        chainId: 10,
        functionName: "setSplitGroupsOf",
      }),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    mocks.receiptSuccess = true;
    rerender();
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(LAST_HASH);
    expect(mocks.runSequentialWrites).not.toHaveBeenCalled();
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
  });

  it.each([
    { label: "mixed mainnets and testnets", chains: [1, 11155111], safe: false },
    { label: "an unsupported chain", chains: [1, 137], safe: false },
    { label: "a Safe connection", chains: [1, 10], safe: true },
    { label: "a testnet Safe connection", chains: [11155111, 84532], safe: true },
  ])("uses sequential writes for $label", async ({ chains, safe }) => {
    mocks.safe = safe;
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSetSplitGroups({ onSuccess }));
    await act(async () => {
      await expect(result.current.submitSplits(splitChains(chains))).resolves.toEqual({
        success: true,
      });
    });
    expect(mocks.runSequentialWrites).toHaveBeenCalledOnce();
    expect(
      mocks.runSequentialWrites.mock.calls[0][0].writes.map((write: ChainWrite) => write.chainId),
    ).toEqual(chains);
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(LAST_HASH);
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.chooseRelayrPayment).not.toHaveBeenCalled();
  });

  it.each(RELAYR_NETWORKS)(
    "holds the supported-$family bundle until the user chooses its funding option",
    async ({ chains, preferred }) => {
      mocks.chainId = preferred;
      const payments = PAYMENTS.map((payment, index) => ({ ...payment, chain: chains[index] }));
      mocks.getRelayrTxQuote.mockResolvedValue({ ...QUOTE, payment_info: payments });
      const onSuccess = vi.fn();
      const selected = deferred<(typeof PAYMENTS)[number]>();
      mocks.chooseRelayrPayment.mockReturnValue(selected.promise);
      const { result } = renderHook(() => useSetSplitGroups({ onSuccess }));
      let pending!: ReturnType<typeof result.current.submitSplits>;
      await act(async () => {
        pending = result.current.submitSplits(splitChains(chains));
      });
      expect(mocks.chooseRelayrPayment).toHaveBeenCalledWith(payments, preferred);
      expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(
        mocks.getRelayrTxQuote.mock.calls[0][0].map((call: { chainId: number }) => call.chainId),
      ).toEqual(chains);

      expect(
        mocks.getRelayrTxQuote.mock.calls[0][0].map(
          (call: { recoveryScope: string }) => call.recoveryScope,
        ),
      ).toEqual(chains.map((chainId) => `project-splits:${chainId}:${chainId}:123:1`));

      await act(async () => {
        selected.resolve(payments[1]);
        await expect(pending).resolves.toEqual({ success: true });
      });
      expect(mocks.sendRelayrTx).toHaveBeenCalledExactlyOnceWith(payments[1]);
      expect(mocks.waitForRelayrBundle).toHaveBeenCalledWith(QUOTE.bundle_uuid);
      expect(onSuccess).toHaveBeenCalledExactlyOnceWith(LAST_HASH);
      expect(mocks.runSequentialWrites).not.toHaveBeenCalled();
    },
  );

  it("does not send or report success after cancelling funding selection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.chooseRelayrPayment.mockRejectedValue(new Error("Transaction review cancelled"));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSetSplitGroups({ onSuccess }));
    await act(async () => {
      await expect(result.current.submitSplits(splitChains([1, 10]))).resolves.toEqual({
        success: false,
      });
    });
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
    expect(mocks.waitForRelayrBundle).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it.each([false, true])(
    "ignores an intermediate receipt until the whole direct batch finishes (failure: %s)",
    async (fails) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const finish = deferred<number>();
      mocks.writeContractAsync.mockImplementationOnce(async () => {
        mocks.lastSubmittedHash = FIRST_HASH;
        return FIRST_HASH;
      });
      mocks.runSequentialWrites.mockImplementation(async ({ writes, writeContractAsync }) => {
        await writeContractAsync(writes[0]);
        await finish.promise;
        await writeContractAsync(writes[1]);
        return 2;
      });
      const onSuccess = vi.fn();
      const { result, rerender } = renderHook(() => useSetSplitGroups({ onSuccess }));
      let pending!: ReturnType<typeof result.current.submitSplits>;
      await act(async () => {
        pending = result.current.submitSplits(splitChains([1, 11155111]));
      });
      // Wagmi's write mutation exposes its first successful hash during a batch.
      mocks.receiptSuccess = true;
      rerender();
      expect(mocks.lastSubmittedHash).toBe(FIRST_HASH);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(result.current.isSubmitting).toBe(true);

      await act(async () => {
        if (fails) finish.reject(new Error("Second chain simulation failed"));
        else finish.resolve(2);
        await expect(pending).resolves.toEqual({ success: !fails });
      });
      if (fails) expect(onSuccess).not.toHaveBeenCalled();
      else expect(onSuccess).toHaveBeenCalledExactlyOnceWith(LAST_HASH);
      expect(result.current.isSubmitting).toBe(false);
    },
  );
});
