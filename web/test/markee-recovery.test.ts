import { recoverMarkeeSubmission } from "@/lib/markee-recovery";
import { SAFE_EXEC_ABI } from "@bananapus/nana-sdk-core/safe-service";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ receipt: vi.fn() }));
vi.mock("@/lib/waitForReceipt", () => ({ waitForReceiptWithRetry: mocks.receipt }));
const account = "0x1111111111111111111111111111111111111111" as Address;
const target = "0x2222222222222222222222222222222222222222" as Address;
const relayer = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
const pending = { target, data: "0x1234" as Hex, value: "7" };
const events = parseAbi(["event ExecutionSuccess(bytes32 txHash,uint256 payment)"]);
const execution = (
  changes: { to?: Address; value?: bigint; data?: Hex; operation?: number } = {},
) => ({
  hash,
  from: relayer,
  to: account,
  input: encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [
      changes.to ?? target,
      changes.value ?? 7n,
      changes.data ?? pending.data,
      changes.operation ?? 0,
      0n,
      0n,
      0n,
      zeroAddress,
      zeroAddress,
      "0x",
    ],
  }),
  value: 0n,
});
const receipt = () => ({
  transactionHash: hash,
  status: "success",
  logs: [
    {
      address: account,
      topics: encodeEventTopics({ abi: events, eventName: "ExecutionSuccess" }),
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [hash, 0n]),
    },
  ],
});
const clientFor = (transaction: unknown, chainId = 8453) =>
  ({
    getChainId: vi.fn(async () => chainId),
    getTransaction: vi.fn(async () => transaction),
  }) as unknown as PublicClient;

beforeEach(() => mocks.receipt.mockResolvedValue(receipt()));

describe("Markee lost wallet reply recovery", () => {
  it("accepts an exact direct transaction without treating it as Safe execution", async () => {
    const result = await recoverMarkeeSubmission(
      clientFor({ hash, from: account, to: target, input: pending.data, value: 7n }),
      account,
      pending,
      hash,
    );
    expect(result).toEqual({ kind: "direct", executionHash: undefined, safeProposal: undefined });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("binds a relayed Safe execution to its exact calls and success event", async () => {
    const result = await recoverMarkeeSubmission(clientFor(execution()), account, pending, hash);
    expect(result).toEqual({
      kind: "safe",
      executionHash: hash,
      safeProposal: {
        safe: account,
        calls: [{ to: target, data: pending.data, value: "7" }],
        batch: false,
      },
    });
  });
  it.each([{ to: relayer }, { value: 8n }, { data: "0x5678" as Hex }, { operation: 1 }])(
    "refuses a different Safe call",
    async (changes) => {
      await expect(
        recoverMarkeeSubmission(clientFor(execution(changes)), account, pending, hash),
      ).rejects.toThrow("does not match");
      expect(mocks.receipt).not.toHaveBeenCalled();
    },
  );
  it.each(["reverted", "success"])(
    "refuses %s receipts lacking the Safe success event",
    async (status) => {
      mocks.receipt.mockResolvedValue({ transactionHash: hash, status, logs: [] });
      await expect(
        recoverMarkeeSubmission(clientFor(execution()), account, pending, hash),
      ).rejects.toThrow("could not be verified");
    },
  );
  it("refuses duplicate execution events", async () => {
    const result = receipt();
    result.logs.push(result.logs[0]);
    mocks.receipt.mockResolvedValue(result);
    await expect(
      recoverMarkeeSubmission(clientFor(execution()), account, pending, hash),
    ).rejects.toThrow("could not be verified");
  });
  it("refuses execution proof from another Safe", async () => {
    const result = receipt();
    result.logs[0].address = relayer;
    mocks.receipt.mockResolvedValue(result);
    await expect(
      recoverMarkeeSubmission(clientFor(execution()), account, pending, hash),
    ).rejects.toThrow("could not be verified");
  });
  it("refuses a different chain and returned transaction hash", async () => {
    await expect(
      recoverMarkeeSubmission(clientFor(execution(), 1), account, pending, hash),
    ).rejects.toThrow("Base");
    await expect(
      recoverMarkeeSubmission(
        clientFor({ ...execution(), hash: `0x${"b".repeat(64)}` }),
        account,
        pending,
        hash,
      ),
    ).rejects.toThrow("hash does not match");
  });
});
