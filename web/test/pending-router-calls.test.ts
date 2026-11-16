import { RouterPendingCallsOperation } from "@/lib/bendystraw/operations";
import { BENDYSTRAW_QUERY_REGISTRY } from "@/lib/bendystraw/registry.server";
import type { IndexedRouterPendingCall } from "@/lib/bendystraw/types";
import {
  createMultichainBatch,
  readMultichainBatches,
  saveMultichainBatch,
} from "@/lib/multichain-batch";
import {
  describeSavedRoutingCall,
  findPendingRoutingBatch,
  pendingRouterCommitment,
  preparePendingRouterPayment,
  readIndexedPendingRouterCalls,
  readPendingRouterPayment,
  requireRawPendingRouterCall,
  simulatePendingRouterCall,
  verifyRouterPendingReceipt,
} from "@/lib/pending-router-calls";
import * as rollout from "@/lib/protocol-rollout";
import { routerGatewayAbi } from "@/lib/router-gateway-abi";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/bendystraw/client", () => ({ queryBendystrawFromBrowser: mocks.query }));
const gateway = "0xe2c259b2fcfd2d57ebcda9b3d2d10bdb1b2cd977" as Address;
const account = "0x0000000000000000000000000000000000000001" as Address;
const id = `0x${"1".repeat(64)}` as Hex;
const call = {
  amount: 100n,
  preferAddToBalance: false,
  shouldReturnHeldFees: false,
  beneficiary: account,
  projectId: 1n,
  refundTo: account,
  sourceProjectId: 7n,
  token: "0x000000000000000000000000000000000000EEEe" as Address,
};
const commitment = pendingRouterCommitment(call, "original memo", "0x1234");
const item: IndexedRouterPendingCall = {
  chainId: 1,
  version: 6,
  gateway,
  pendingCallId: id,
  projectId: 1,
  sourceProjectId: 7,
  token: call.token,
  amount: "100",
  retainedAmount: "100",
  preferAddToBalance: false,
  shouldReturnHeldFees: false,
  beneficiary: account,
  refundTo: account,
  memo: "original memo",
  metadata: "0x1234",
  callCommitment: commitment,
  status: "queued",
};
const tupleParameters = parseAbiParameters(
  "(uint256 amount,bool preferAddToBalance,bool shouldReturnHeldFees,address beneficiary,uint256 projectId,address refundTo,uint256 sourceProjectId,address token)",
);
const guard = {
  gateway,
  pendingCallId: id,
  callHash: keccak256(encodeAbiParameters(tupleParameters, [call])),
};

function client(
  options: { count?: number; timestamp?: bigint; commitment?: Hex; gasExhausted?: boolean } = {},
) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "pendingCallCommitmentOf") return options.commitment ?? commitment;
      if (functionName === "pendingCallFailureOf")
        return {
          errorHash: options.gasExhausted
            ? keccak256(stringToHex("JBRouterTerminalGateway: gas exhausted"))
            : zeroHash,
          count: options.count ?? 0,
          lastFailureAt: 100,
          highestGasLimit: 0n,
        };
      if (functionName === "RETRY_DELAY") return 86_400n;
      if (functionName === "maximumQualifiedCallGas") return 15_038_509n;
      throw new Error(`unexpected read ${functionName}`);
    }),
    getBlock: vi.fn(async () => ({
      timestamp: options.timestamp ?? 86_500n,
      gasLimit: 30_000_000n,
    })),
    request: vi.fn(async () => `0x${"0".repeat(128)}`),
    estimateContractGas: vi.fn(async () => 5_900_000n),
  } as unknown as Parameters<typeof readPendingRouterPayment>[0];
}
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("original pending router calls", () => {
  it("lists incoming payments on destination 1, never on their source 6", async () => {
    const incoming = [
      { ...item, sourceProjectId: 6 },
      { ...item, sourceProjectId: 9, pendingCallId: `0x${"2".repeat(64)}` },
    ];
    mocks.query.mockImplementation(async (_operation, variables) => {
      const items = incoming.filter(
        (payment) =>
          payment.projectId === variables.projectId && payment.gateway === variables.gateway,
      );
      return { routerPendingCalls: { items, totalCount: items.length } };
    });
    expect(await readIndexedPendingRouterCalls({ chainId: 1, projectId: 1, version: 6 })).toEqual(
      incoming,
    );
    expect(await readIndexedPendingRouterCalls({ chainId: 1, projectId: 6, version: 6 })).toEqual(
      [],
    );
    const query = BENDYSTRAW_QUERY_REGISTRY[RouterPendingCallsOperation.id].query;
    expect(query).toContain("projectId: $projectId");
    expect(query).not.toContain("sourceProjectId:");
    expect(mocks.query.mock.calls[0][1]).toMatchObject({ chainId: 1, projectId: 1 });
    expect(mocks.query.mock.calls[0][1]).not.toHaveProperty("sourceProjectId");
  });

  it("rejects an outgoing payment even when its source matches the viewed project", async () => {
    mocks.query.mockResolvedValue({
      routerPendingCalls: { items: [{ ...item, sourceProjectId: 6 }], totalCount: 1 },
    });
    await expect(
      readIndexedPendingRouterCalls({ chainId: 1, projectId: 6, version: 6 }),
    ).rejects.toThrow("inconsistent project");
  });

  it("paginates each recorded gateway independently when generations reuse a pending ID", async () => {
    const original = rollout.rolloutChain(1)!;
    const previous = "0x0000000000000000000000000000000000000099";
    vi.spyOn(rollout, "rolloutChain").mockReturnValue({
      ...original,
      history: { ...original.history, JBRouterTerminalGateway: { previous, v1: null } },
    });
    mocks.query.mockImplementation(async (_operation, variables) => ({
      routerPendingCalls: {
        items: [{ ...item, gateway: variables.gateway }],
        totalCount: 1,
      },
    }));
    const rows = await readIndexedPendingRouterCalls({ chainId: 1, projectId: 1, version: 6 });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.gateway))).toEqual(new Set([gateway, previous]));
    expect(mocks.query.mock.calls.every((args) => args[1].offset === 0)).toBe(true);
  });
  it("loads every destination-project page, rejects truncation and cross-project results", async () => {
    const original = rollout.rolloutChain(1)!;
    vi.spyOn(rollout, "rolloutChain").mockReturnValue({
      ...original,
      history: { ...original.history, JBRouterTerminalGateway: {} },
    });
    mocks.query
      .mockResolvedValueOnce({ routerPendingCalls: { items: [item], totalCount: 2 } })
      .mockResolvedValueOnce({
        routerPendingCalls: {
          items: [{ ...item, pendingCallId: `0x${"2".repeat(64)}` }],
          totalCount: 2,
        },
      });
    expect(
      await readIndexedPendingRouterCalls({ chainId: 1, projectId: 1, version: 6 }),
    ).toHaveLength(2);
    expect(mocks.query.mock.calls[1][1]).toEqual({
      chainId: 1,
      projectId: 1,
      gateway,
      limit: 100,
      offset: 1,
    });
    mocks.query.mockResolvedValueOnce({ routerPendingCalls: { items: [], totalCount: 1 } });
    await expect(
      readIndexedPendingRouterCalls({ chainId: 1, projectId: 1, version: 6 }),
    ).rejects.toThrow("changed while loading");
    mocks.query.mockResolvedValueOnce({
      routerPendingCalls: { items: [{ ...item, projectId: 8 }], totalCount: 1 },
    });
    await expect(
      readIndexedPendingRouterCalls({ chainId: 1, projectId: 1, version: 6 }),
    ).rejects.toThrow("inconsistent project");
  });

  it("rejects modified memo or beneficiary before any onchain action", async () => {
    const rpc = client();
    await expect(readPendingRouterPayment(rpc, { ...item, memo: "edited" })).rejects.toThrow(
      "original commitment",
    );
    await expect(readPendingRouterPayment(rpc, { ...item, beneficiary: gateway })).rejects.toThrow(
      "original commitment",
    );
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("removes resolved indexed rows and rejects a changed live commitment", async () => {
    expect(await readPendingRouterPayment(client({ commitment: zeroHash }), item)).toBeNull();
    await expect(readPendingRouterPayment(client({ commitment: id }), item)).rejects.toThrow(
      "gateway's pending commitment",
    );
  });

  it("moves discovery of saved source-6 attempts to destination 1 without changing their recovery journal", async () => {
    const sourceCall = { ...call, sourceProjectId: 6n };
    const sourceCommitment = pendingRouterCommitment(sourceCall, item.memo, item.metadata as Hex);
    const prepared = await preparePendingRouterPayment(
      client({ commitment: sourceCommitment }),
      { ...item, sourceProjectId: 6, callCommitment: sourceCommitment },
      account,
    );
    const legacy = createMultichainBatch(
      account,
      "pending-routing:1:6",
      "Route pending payments",
      [{ ...prepared.call, relayrMode: undefined }],
      "direct",
    );
    legacy.calls[0].state = "submitted";
    legacy.calls[0].hash = id;
    expect(describeSavedRoutingCall(legacy.calls[0])).toMatchObject({
      chainId: 1,
      projectId: "1",
      sourceProjectId: "6",
      pendingCallId: item.pendingCallId,
      beneficiary: item.beneficiary,
      state: "submitted",
      hash: id,
    });
    expect(() => describeSavedRoutingCall({ ...legacy.calls[0], data: "0x" })).toThrow();
    saveMultichainBatch(legacy);
    expect(
      findPendingRoutingBatch(account, [{ chainId: 1, projectId: 6, version: 6 }]),
    ).toBeUndefined();
    expect(findPendingRoutingBatch(account, [{ chainId: 1, projectId: 1, version: 6 }])).toEqual(
      legacy,
    );
    expect(
      findPendingRoutingBatch(gateway, [{ chainId: 1, projectId: 1, version: 6 }]),
    ).toBeUndefined();
    expect(
      findPendingRoutingBatch(account, [{ chainId: 8453, projectId: 1, version: 6 }]),
    ).toBeUndefined();
    expect(readMultichainBatches()).toEqual([legacy]);
    // A crash between saving the last receipt and completing the batch must remain resumable.
    legacy.calls[0].state = "success";
    saveMultichainBatch(legacy);
    expect(findPendingRoutingBatch(account, [{ chainId: 1, projectId: 1, version: 6 }])).toEqual(
      legacy,
    );
    expect(
      findPendingRoutingBatch(account, [{ chainId: 1, projectId: 6, version: 6 }]),
    ).toBeUndefined();
  });

  it.each([0, 3])(
    "authenticates the exact raw Relayr routing attempt after %s failures",
    async (count) => {
      const prepared = await preparePendingRouterPayment(client({ count }), item, account);
      const { abi, functionName, args, preconditions } = prepared.call;
      const data = encodeFunctionData({ abi, functionName, args });
      expect(() =>
        requireRawPendingRouterCall(1, gateway, data, 0n, guard, preconditions),
      ).not.toThrow();
      expect(() =>
        requireRawPendingRouterCall(1, gateway, data, 1n, guard, preconditions),
      ).toThrow();
      expect(() =>
        requireRawPendingRouterCall(1, account, data, 0n, guard, preconditions),
      ).toThrow();
      expect(() =>
        requireRawPendingRouterCall(999, gateway, data, 0n, guard, preconditions),
      ).toThrow();
      expect(() =>
        requireRawPendingRouterCall(1, gateway, `${data}00`, 0n, guard, preconditions),
      ).toThrow("canonical");
      expect(() =>
        requireRawPendingRouterCall(
          1,
          gateway,
          data,
          0n,
          { ...guard, pendingCallId: zeroHash },
          preconditions,
        ),
      ).toThrow("reviewed payment");
      expect(() =>
        requireRawPendingRouterCall(
          1,
          gateway,
          data,
          0n,
          { ...guard, callHash: zeroHash },
          preconditions,
        ),
      ).toThrow("reviewed payment");
      expect(() => requireRawPendingRouterCall(1, gateway, data, 0n, guard, [])).toThrow("checks");
      expect(() =>
        requireRawPendingRouterCall(1, gateway, data, 0n, guard, preconditions?.slice(0, 1)),
      ).toThrow("checks");
      const altered = encodeFunctionData({
        abi: routerGatewayAbi,
        functionName: prepared.payment.action,
        args: [id, call, "changed memo", "0x1234"],
      });
      expect(() =>
        requireRawPendingRouterCall(1, gateway, altered, 0n, guard, preconditions),
      ).toThrow("checks");
      const read = encodeFunctionData({
        abi: routerGatewayAbi,
        functionName: "pendingCallCommitmentOf",
        args: [id],
      });
      expect(() => requireRawPendingRouterCall(1, gateway, read, 0n, guard, preconditions)).toThrow(
        "supports only",
      );
    },
  );

  it("uses chain time for cooldown and freezes both live commitment and failure reads", async () => {
    const rpc = client({ count: 1, timestamp: 86_499n });
    const pending = await readPendingRouterPayment(rpc, item);
    expect(pending).toMatchObject({ ready: false, nextAttemptAt: 86_500n });
    await expect(preparePendingRouterPayment(rpc, item, account)).rejects.toThrow("cooldown");
    expect(rpc.request).not.toHaveBeenCalled();
    const prepared = await preparePendingRouterPayment(client(), item, account);
    expect(prepared.call).toMatchObject({
      value: 0n,
      relayrMode: "raw",
      functionName: "processPendingCall",
      args: [id, call, "original memo", "0x1234"],
      expectedRouterPending: guard,
    });
    expect(prepared.call.preconditions).toHaveLength(2);
  });

  it("wallet-action:pending-routing uses finalization after three failures and carries the higher qualified gas rung", async () => {
    const rpc = client({ count: 3, gasExhausted: true });
    const result = await preparePendingRouterPayment(rpc, item, account);
    expect(result.call.functionName).toBe("finalizePendingCall");
    expect(result.call.gas).toBeGreaterThan(15_000_000n);
    expect(result.call.gas).toBeLessThanOrEqual(16_777_216n);
    expect(rpc.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "eth_call",
        params: [
          expect.objectContaining({
            gas: `0x${result.call.gas!.toString(16)}`,
            from: account,
            value: "0x0",
          }),
          "latest",
        ],
      }),
    );
  });

  it("measures complex finalizer refunds with the full transaction cap instead of the reserve heuristic", async () => {
    const rpc = client({ count: 3 });
    vi.mocked(rpc.estimateContractGas).mockResolvedValue(9_000_000n);
    const result = await preparePendingRouterPayment(rpc, item, account);
    expect(result.call.gas).toBe(16_777_216n);
    expect(rpc.estimateContractGas).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 16_777_216n }),
    );
    expect(rpc.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "eth_call",
        params: [expect.objectContaining({ gas: "0x1000000" }), "latest"],
      }),
    );
  });

  it("lets OffchainLookup fail without following token-controlled URLs", async () => {
    const rpc = client();
    vi.mocked(rpc.request).mockRejectedValue(new Error("execution reverted: OffchainLookup"));
    await expect(
      simulatePendingRouterCall(rpc, {
        from: account,
        to: gateway,
        data: "0x1234",
        gas: 10_000_000n,
      }),
    ).rejects.toThrow("OffchainLookup");
    expect(rpc.request).toHaveBeenCalledTimes(1);
  });

  it("recognizes an executed retry that retains custody, including finalizer changed-error outcomes", () => {
    const receipt = {
      status: "success",
      logs: [
        {
          address: gateway,
          topics: encodeEventTopics({
            abi: routerGatewayAbi,
            eventName: "JBRouterTerminalGateway_RecordTerminalCallFailure",
            args: { id, errorHash: zeroHash },
          }),
          data: encodeAbiParameters(parseAbiParameters("uint32,uint256,address"), [
            1,
            200_000n,
            account,
          ]),
        },
      ],
    } as unknown as TransactionReceipt;
    expect(verifyRouterPendingReceipt(receipt, guard)).toBe("pending");
    expect(() =>
      verifyRouterPendingReceipt(receipt, { ...guard, pendingCallId: zeroHash }),
    ).toThrow("no unique verified");
    expect(() => verifyRouterPendingReceipt({ ...receipt, logs: [] }, guard)).toThrow(
      "no unique verified",
    );
  });

  it("checks settled payment tuple and rejects an unrelated gateway or altered amount", () => {
    const receipt = {
      status: "success",
      logs: [
        {
          address: gateway,
          topics: encodeEventTopics({
            abi: routerGatewayAbi,
            eventName: "JBRouterTerminalGateway_ProcessPendingCall",
            args: { id },
          }),
          data: encodeAbiParameters(
            [...tupleParameters, { type: "uint256" }, { type: "address" }],
            [call, 0n, account],
          ),
        },
      ],
    } as unknown as TransactionReceipt;
    expect(verifyRouterPendingReceipt(receipt, guard)).toBe("settled");
    expect(() => verifyRouterPendingReceipt(receipt, { ...guard, callHash: zeroHash })).toThrow(
      "reviewed payment",
    );
    expect(() => verifyRouterPendingReceipt(receipt, { ...guard, gateway: account })).toThrow(
      "no unique verified",
    );
  });
});
