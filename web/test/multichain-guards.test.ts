import {
  requireRawPayerCall,
  verifyActionReceipt,
  verifyCallPreconditions,
  type ExpectedPayerDeployment,
} from "@/lib/multichain-guards";
import { jbControllerAbi, jbTokensAbi } from "@bananapus/nana-sdk-core";
import { safeRelayrPreconditions } from "@bananapus/nana-sdk-core/review/safe-relayr";
import { SAFE_EXEC_ABI, canonicalSafeTxHash } from "@bananapus/nana-sdk-core/safe-service";
import { JB_PROJECT_PAYER_DEPLOYER, jbProjectPayerDeployerAbi } from "@bananapus/nana-sdk-core/v6";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it, vi } from "vitest";
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const PAYER = "0x2222222222222222222222222222222222222222" as Address;
const expected: ExpectedPayerDeployment = {
  kind: "project-payer",
  projectId: "4",
  beneficiary: OWNER,
  owner: OWNER,
  addToBalance: false,
  memo: "Payer",
  metadata: "0x1234",
  directory: OWNER,
};
const calldata = encodeFunctionData({
  abi: jbProjectPayerDeployerAbi,
  functionName: "deployProjectPayer",
  args: [4n, OWNER, "Payer", "0x1234", false, OWNER],
});
function receipt(owner = OWNER) {
  const topics = encodeEventTopics({
    abi: jbProjectPayerDeployerAbi,
    eventName: "DeployProjectPayer",
    args: { projectPayer: PAYER },
  });
  const data = encodeAbiParameters(
    parseAbiParameters("uint256,address,string,bytes,bool,address,address,address"),
    [4n, OWNER, "Payer", "0x1234", false, OWNER, owner, PAYER],
  );
  return {
    logs: [{ address: JB_PROJECT_PAYER_DEPLOYER, topics, data }],
  } as unknown as TransactionReceipt;
}
describe("multichain source and exact recipient-result guards", () => {
  describe("a reserved token distribution", () => {
    const CONTROLLER = "0x3333333333333333333333333333333333333333" as Address;
    const TOKENS = "0x4444444444444444444444444444444444444444" as Address;
    const HOLDER = "0x5555555555555555555555555555555555555555" as Address;
    const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;
    const burnSplit = {
      percent: 100_000_000,
      projectId: 0n,
      beneficiary: DEAD,
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: zeroAddress,
    };
    const holderSplit = { ...burnSplit, percent: 500_000_000, beneficiary: HOLDER };
    // As the distribution batch journals it: JSON-safe, with the reviewed splits in order.
    const reviewed = {
      controller: CONTROLLER,
      tokens: TOKENS,
      projectId: "4",
      rulesetId: "1",
      cycleNumber: "1",
      owner: OWNER,
      caller: OWNER,
      tokenCount: "100",
      splits: [burnSplit, holderSplit].map((split) => ({ ...split, projectId: "0" })),
    };
    function event(abi: Abi, address: Address, name: string, args: Record<string, unknown>) {
      const item = abi.find((entry) => entry.type === "event" && entry.name === name) as AbiEvent;
      const unindexed = item.inputs.filter((input) => !input.indexed);
      return {
        address,
        topics: encodeEventTopics({ abi: [item], eventName: name, args }),
        data: encodeAbiParameters(
          unindexed,
          unindexed.map((input) => args[input.name!]),
        ),
      };
    }
    const sent = (split: typeof burnSplit, tokenCount: bigint) =>
      event(jbControllerAbi, CONTROLLER, "SendReservedTokensToSplit", {
        projectId: 4n,
        rulesetId: 1n,
        groupId: 1n,
        split,
        tokenCount,
        caller: OWNER,
      });
    const total = event(jbControllerAbi, CONTROLLER, "SendReservedTokensToSplits", {
      rulesetId: 1n,
      rulesetCycleNumber: 1n,
      projectId: 4n,
      owner: OWNER,
      tokenCount: 100n,
      leftoverAmount: 40n,
      caller: OWNER,
    });
    const burned = (count: bigint) =>
      event(jbTokensAbi, TOKENS, "Burn", {
        holder: CONTROLLER,
        projectId: 4n,
        count,
        creditBalance: 0n,
        tokenBalance: 0n,
        caller: OWNER,
      });
    const verify = (logs: unknown[]) =>
      verifyActionReceipt(
        {} as PublicClient,
        { logs } as unknown as TransactionReceipt,
        CONTROLLER,
        undefined,
        [],
        reviewed,
      );

    it("accepts every reviewed split's share, burning only what was sent to 0x…dEaD", async () => {
      await expect(
        verify([sent(burnSplit, 10n), sent(holderSplit, 50n), total, burned(10n)]),
      ).resolves.toBeUndefined();
    });

    it("refuses a receipt missing a split's event", async () => {
      await expect(verify([sent(burnSplit, 10n), total, burned(10n)])).rejects.toThrow(
        "the receipt sends to 1 splits, not the reviewed 2",
      );
    });

    it("refuses tokens burned beyond the reviewed burns, as a hook that took nothing", async () => {
      await expect(
        verify([sent(burnSplit, 10n), sent(holderSplit, 50n), total, burned(11n)]),
      ).rejects.toThrow("a hook did not take its share");
    });

    it("refuses a receipt without the distribution's total", async () => {
      await expect(
        verify([sent(burnSplit, 10n), sent(holderSplit, 50n), burned(10n)]),
      ).rejects.toThrow("0 SendReservedTokensToSplits events");
    });
  });
  it("rejects destination state drift before any wallet action", async () => {
    const call = vi.fn().mockResolvedValue({ data: "0x02" });
    await expect(
      verifyCallPreconditions({ call } as unknown as PublicClient, [
        { address: OWNER, data: "0x1234", expected: "0x01" },
      ]),
    ).rejects.toThrow(/reviewed state changed/);
    expect(call).toHaveBeenCalledWith({ to: OWNER, data: "0x1234" });
  });
  it("reads equivalent hex snapshots once per pass and reads fresh state on the next pass", async () => {
    const guard = {
      address: "0x000000000000000000000000000000000000aBcD",
      data: "0xabcd",
      expected: "0xAb",
    } as const;
    const guards = [
      guard,
      {
        address: guard.address.toLowerCase() as Address,
        data: "0xABCD" as Hex,
        expected: "0xaB" as Hex,
      },
      { ...guard, address: PAYER },
      { ...guard, data: "0xabce" as Hex },
    ];
    const original = structuredClone(guards);
    const call = vi.fn().mockResolvedValue({ data: "0xab" });
    const client = { call } as unknown as PublicClient;
    await verifyCallPreconditions(client, guards);
    expect(call.mock.calls).toEqual([
      [{ to: guard.address, data: guard.data }],
      [{ to: PAYER, data: guard.data }],
      [{ to: guard.address, data: "0xabce" }],
    ]);
    expect(guards).toEqual(original);
    call.mockResolvedValue({ data: "0xac" });
    await expect(verifyCallPreconditions(client, guards)).rejects.toThrow(/reviewed state changed/);
    expect(call).toHaveBeenCalledTimes(4);
  });
  it("retains conflicting expectations for the same read and refuses the mismatch", async () => {
    const call = vi.fn().mockResolvedValue({ data: "0x01" });
    await expect(
      verifyCallPreconditions({ call } as unknown as PublicClient, [
        { address: OWNER, data: "0x1234", expected: "0x01" },
        { address: OWNER, data: "0x1234", expected: "0x02" },
      ]),
    ).rejects.toThrow(/reviewed state changed/);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("restricts raw Relayr to the exact caller-independent canonical payer factory call", () => {
    expect(() =>
      requireRawPayerCall(JB_PROJECT_PAYER_DEPLOYER, calldata, 0n, expected),
    ).not.toThrow();
    expect(() => requireRawPayerCall(PAYER, calldata, 0n, expected)).toThrow(/canonical/);
    expect(() => requireRawPayerCall(JB_PROJECT_PAYER_DEPLOYER, "0x1234", 0n, expected)).toThrow(
      /settings/,
    );
    expect(() => requireRawPayerCall(JB_PROJECT_PAYER_DEPLOYER, calldata, 1n, expected)).toThrow(
      /canonical/,
    );
  });
  it("requires a single matching payer event and deployed code, allowing the raw relayer sender", async () => {
    const getCode = vi.fn().mockResolvedValue("0x6000");
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        receipt(),
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).resolves.toBeUndefined();
    expect(getCode).toHaveBeenCalledWith({ address: PAYER });
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        receipt(PAYER),
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).rejects.toThrow(/frozen review/);
    const duplicate = receipt();
    duplicate.logs.push(duplicate.logs[0]);
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        duplicate,
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).rejects.toThrow(/exactly one/);
    getCode.mockResolvedValue("0x");
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        receipt(),
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).rejects.toThrow(/no deployed code/);
  });
  it("does not accept a successful receipt containing a rejected payout event", async () => {
    const topic = `0x${"ab".repeat(32)}` as Hex;
    const result = {
      logs: [{ address: OWNER, topics: [topic], data: "0x" }],
    } as unknown as TransactionReceipt;
    await expect(
      verifyActionReceipt({} as PublicClient, result, OWNER, undefined, [
        { topic, address: OWNER },
      ]),
    ).rejects.toThrow(/incomplete recipient/);
  });
});

describe("raw Safe executions", () => {
  const SAFE = "0x0000000000000000000000000000000000005afe" as Address;
  const SAFE_TX_HASH = canonicalSafeTxHash(1, SAFE, {
    to: SAFE,
    value: 0n,
    data: "0x1234",
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: 7,
  });
  const exec = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [SAFE, 0n, "0x1234", 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"],
  });
  const expected = {
    safe: SAFE,
    safeTxHash: SAFE_TX_HASH,
    nonce: 7,
    entry: { chain: 1, target: SAFE, data: exec, value: "0" },
  };

  it("pins execTransaction on that Safe to its live nonce and exact transaction hash", () => {
    const [nonce, hash] = safeRelayrPreconditions(expected);
    expect(nonce).toEqual({
      address: SAFE,
      data: toFunctionSelector("function nonce()"),
      expected: encodeAbiParameters(parseAbiParameters("uint256"), [7n]),
    });
    expect(hash.address).toBe(SAFE);
    expect(hash.expected).toBe(SAFE_TX_HASH);
    expect(
      hash.data.startsWith(
        toFunctionSelector(
          "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)",
        ),
      ),
    ).toBe(true);
  });

  it("rejects another target, value, a missing review, or a call that is not execTransaction", () => {
    expect(() =>
      safeRelayrPreconditions({ ...expected, entry: { ...expected.entry, target: PAYER } }),
    ).toThrow(/Safe execution/);
    expect(() =>
      safeRelayrPreconditions({ ...expected, entry: { ...expected.entry, value: "1" } }),
    ).toThrow(/Safe execution/);
    expect(() =>
      safeRelayrPreconditions({ ...expected, entry: { ...expected.entry, data: "0x1234" } }),
    ).toThrow(/signature|decode|data|execution/i);
  });
});
