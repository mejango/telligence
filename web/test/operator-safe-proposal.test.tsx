import { useOperatorWrites } from "@/app/[slug]/components/v6/operator/useOperatorWrites";
import {
  safeProposalFor,
  safeTransactionHash,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { act, renderHook } from "@testing-library/react";
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  provenSafe,
  queuedRow,
  SAFE_OWNER_A,
  safeChain,
  safeTransactionService,
} from "./fixtures/safe-chain";

const SAFE = provenSafe();
const [SIGNER, CO_SIGNER] = SAFE.owners;
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const ABI = parseAbi(["function setHookFor(uint256 projectId, address hook)"]);
const ARGS = [42n, TARGET] as const;
const CALL_DATA = encodeFunctionData({ abi: ABI, functionName: "setHookFor", args: ARGS });
const SIGNATURE = `0x${"12".repeat(64)}1b` as Hex;

const mocks = vi.hoisted(() => ({ sign: vi.fn(), client: undefined as unknown }));

vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: "0x2222222222222222222222222222222222222222", chainId: 8453 }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: vi.fn(), reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: vi.fn() }),
  waitForRelayrBundle: vi.fn(),
}));
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnection: () => false,
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionState } = await import("./support/reviewed-action");
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useSafeTransactionSignature: () => ({ signSafeTransactionAsync: mocks.sign }),
    useReviewedAction: () => reviewedActionState(vi.fn()),
  };
});
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: () => mocks.client,
}));

/** Base's operator Safe at nonce 5 with `pending` in its queue; the connected wallet signs for it. */
function queue(pending: SafeQueuedTransaction[] = []) {
  const service = safeTransactionService("base", SAFE.address, pending);
  vi.stubGlobal("fetch", service.fetch);
  return service;
}

async function runWrite() {
  const { result } = renderHook(() => useOperatorWrites());
  let outcome: Awaited<ReturnType<ReturnType<typeof useOperatorWrites>["runWrites"]>>;
  await act(async () => {
    outcome = await result.current.runWrites({
      writes: [
        {
          chainId: 8453,
          address: TARGET,
          abi: ABI,
          functionName: "setHookFor",
          args: ARGS,
          authority: SAFE.address,
        },
      ],
      account: SIGNER,
      label: "Set buyback hook",
      onProgress: vi.fn(),
    });
  });
  return outcome!;
}

const sameCall = (nonce: number) => safeProposalFor({ to: TARGET, data: CALL_DATA }, nonce);

beforeEach(() => {
  mocks.client = {
    ...safeChain(SAFE.address, { nonce: 5n }).client,
    simulateContract: vi.fn(async () => ({ result: undefined })),
  };
  mocks.sign.mockResolvedValue(SIGNATURE);
});

describe("an operator write signed for the operator Safe", () => {
  it("wallet-action:operator-writes queues the exact call with this app's origin at the next free nonce", async () => {
    const other = queuedRow(8453, SAFE.address, safeProposalFor({ to: TARGET, data: "0x12" }, 5));
    const service = queue([other]);

    await expect(runWrite()).resolves.toMatchObject({ safeQueued: 1, safeConfirmed: 0 });
    const proposed = sameCall(6);
    expect(service.posts).toEqual([
      {
        url: `https://juicebox.center/v1/safe/base/api/v1/safes/${SAFE.address}/multisig-transactions/`,
        body: {
          to: getAddress(TARGET),
          value: "0",
          data: CALL_DATA,
          operation: 0,
          safeTxGas: "0",
          baseGas: "0",
          gasPrice: "0",
          gasToken: "0x0000000000000000000000000000000000000000",
          refundReceiver: "0x0000000000000000000000000000000000000000",
          nonce: "6",
          contractTransactionHash: safeTransactionHash(8453, SAFE.address, proposed),
          sender: SIGNER,
          signature: SIGNATURE,
          origin: "revnet.money",
        },
      },
    ]);
  });

  it("confirms an identical queued proposal instead of queuing it twice", async () => {
    const queued = queuedRow(8453, SAFE.address, sameCall(5), [
      { owner: CO_SIGNER, signature: SIGNATURE },
    ]);
    const service = queue([queued]);

    await expect(runWrite()).resolves.toMatchObject({ safeQueued: 0, safeConfirmed: 1 });
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(service.posts).toEqual([
      {
        url: `https://juicebox.center/v1/safe/base/api/v1/multisig-transactions/${queued.safeTxHash}/confirmations/`,
        body: { signature: SIGNATURE },
      },
    ]);
  });

  it("signs nothing more when its own confirmation already counts", async () => {
    const service = queue([
      queuedRow(8453, SAFE.address, sameCall(5), [{ owner: SAFE_OWNER_A, signature: SIGNATURE }]),
    ]);

    await expect(runWrite()).resolves.toMatchObject({ safeConfirmed: 1 });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(service.posts).toEqual([]);
  });

  it("queues its own call rather than confirm a queued copy that pays a refund", async () => {
    const service = queue([queuedRow(8453, SAFE.address, { ...sameCall(5), gasPrice: "1" })]);

    await expect(runWrite()).resolves.toMatchObject({ safeQueued: 1, safeConfirmed: 0 });
    expect(service.posts).toEqual([
      expect.objectContaining({ body: expect.objectContaining({ nonce: "6", gasPrice: "0" }) }),
    ]);
  });

  it("surfaces a service refusal instead of reporting the proposal queued", async () => {
    const service = queue();
    service.fetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("Address not checksumed", { status: 422 })
        : new Response(JSON.stringify({ next: null, results: [] })),
    );

    await expect(runWrite()).rejects.toThrow(/422/);
  });
});
