import {
  autoIssuanceKey,
  intentionalReservedBurn,
  prepareAutoIssuance,
  prepareCreditClaim,
  prepareReservedDistribution,
  type DistributionClient,
} from "@/app/[slug]/owners/components/ownerDistributionBatch";
import {
  jbControllerAbi,
  jbDirectoryAbi,
  jbSplitsAbi,
  jbTokensAbi,
} from "@bananapus/nana-sdk-core";
import { buildAutoIssueTx } from "@bananapus/nana-sdk-core/v6";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  zeroAddress,
  type Address,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = "0x0000000000000000000000000000000000000001" as Address;
const controller = "0x0000000000000000000000000000000000000002" as Address;
const registry = "0x0000000000000000000000000000000000000003" as Address;
const token = "0x0000000000000000000000000000000000000004" as Address;
const directory = "0x0000000000000000000000000000000000000005" as Address;
const projects = "0x0000000000000000000000000000000000000006" as Address;
const identity = { chainId: 10 as const, projectId: 91n, directory, projects };
const allocation = { ...identity, stageId: 200n, beneficiary: account };
const revnetOwner = buildAutoIssueTx({
  chainId: 10,
  revnetId: 91n,
  stageId: 200n,
  beneficiary: account,
}).address;
const rawRuleset = {
  cycleNumber: 1,
  id: 200,
  basedOnId: 0,
  start: 100,
  duration: 0,
  weight: 1000n,
  weightCutPercent: 0,
  approvalHook: zeroAddress,
  metadata: 0n,
};
const expandedMetadata = {
  reservedPercent: 1000,
  cashOutTaxRate: 0,
  baseCurrency: 1,
  pausePay: false,
  pauseCreditTransfers: false,
  allowOwnerMinting: true,
  allowSetCustomToken: false,
  allowTerminalMigration: false,
  allowSetTerminals: false,
  allowSetController: false,
  allowAddAccountingContext: false,
  allowAddPriceFeed: false,
  ownerMustSendPayouts: false,
  holdFees: false,
  scopeCashOutsToLocalBalances: false,
  useDataHookForPay: false,
  useDataHookForCashOut: false,
  dataHook: zeroAddress,
  metadata: 0,
};
const split = {
  percent: 600_000_000,
  projectId: 12n,
  beneficiary: account,
  preferAddToBalance: true,
  lockedUntil: 900,
  hook: zeroAddress,
};
let values: Record<string, unknown>;
const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
  if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
  return values[functionName];
});
const simulateContract = vi.fn(async () => ({}));
const getBlock = vi.fn(async () => ({ timestamp: 100n }));
const client = { readContract, simulateContract, getBlock } as unknown as DistributionClient;

beforeEach(() => {
  vi.clearAllMocks();
  values = {
    controllerOf: controller,
    pendingReservedTokenBalanceOf: 700n,
    currentRulesetOf: [rawRuleset, expandedMetadata],
    getRulesetOf: [rawRuleset, expandedMetadata],
    SPLITS: registry,
    splitsOf: [split],
    ownerOf: revnetOwner,
    TOKENS: registry,
    tokenOf: token,
    creditBalanceOf: 900n,
    CONTROLLER: controller,
    amountToAutoIssue: 500n,
  };
});

describe("wallet-action:owner-distributions", () => {
  it("counts only direct burn-sentinel splits, rounding each recipient separately", () => {
    const burn = {
      ...split,
      projectId: 0n,
      beneficiary: "0x000000000000000000000000000000000000dEaD" as Address,
      percent: 333_333_333,
    };
    expect(intentionalReservedBurn(5n, [burn, burn])).toBe(2n);
    expect(
      intentionalReservedBurn(5n, [
        { ...burn, hook: token },
        { ...burn, projectId: 12n },
        { ...burn, beneficiary: account },
      ]),
    ).toBe(0n);
  });
  it("targets the destination's active controller and current ruleset, preserving every split field", async () => {
    const result = await prepareReservedDistribution(client, identity, account);
    expect(result.call).toMatchObject({
      chainId: 10,
      address: controller,
      functionName: "sendReservedTokensToSplitsOf",
      args: [91n],
    });
    expect(result.amount).toBe(700n);
    expect(result.call.rejectEvents).toHaveLength(2);
    expect(result.call.reservedReceipt).toEqual({
      controller,
      tokenRegistry: registry,
      projectId: "91",
      amount: "700",
      intentionalBurn: "0",
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "splitsOf",
        address: registry,
        args: [91n, 200n, 1n],
      }),
    );
    const guard = result.call.preconditions.find(
      (condition) =>
        condition.data ===
        encodeFunctionData({ abi: jbSplitsAbi, functionName: "splitsOf", args: [91n, 200n, 1n] }),
    )!;
    expect(
      decodeFunctionResult({ abi: jbSplitsAbi, functionName: "splitsOf", data: guard.expected }),
    ).toEqual([split]);
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ account, address: controller, args: [91n] }),
    );
    expect(JSON.parse(JSON.stringify(result.call.preconditions))).toEqual(
      result.call.preconditions,
    );
  });

  it("guards controller identity and the full amount rather than trusting displayed balances", async () => {
    const result = await prepareReservedDistribution(client, identity, account);
    const first = result.call.preconditions[0];
    expect(first.address).toBe(directory);
    expect(decodeFunctionData({ abi: jbDirectoryAbi, data: first.data })).toMatchObject({
      functionName: "controllerOf",
      args: [91n],
    });
    expect(
      decodeFunctionResult({
        abi: jbDirectoryAbi,
        functionName: "controllerOf",
        data: first.expected,
      }),
    ).toBe(controller);
    const pending = result.call.preconditions[1];
    expect(
      decodeFunctionResult({
        abi: jbControllerAbi,
        functionName: "pendingReservedTokenBalanceOf",
        data: pending.expected,
      }),
    ).toBe(700n);
  });

  it("stops a consumed reserve before transaction simulation", async () => {
    values.pendingReservedTokenBalanceOf = 0n;
    await expect(prepareReservedDistribution(client, identity, account)).rejects.toThrow(
      "no pending reserved tokens",
    );
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it("propagates a destination simulation failure", async () => {
    simulateContract.mockRejectedValueOnce(new Error("split hook reverted"));
    await expect(prepareReservedDistribution(client, identity, account)).rejects.toThrow(
      "split hook reverted",
    );
  });
});

describe("credit claim snapshots", () => {
  it("uses the runtime token registry and fresh holder balance, keeping holder and beneficiary bound", async () => {
    const result = await prepareCreditClaim(client, identity, account);
    expect(result.call).toMatchObject({
      address: controller,
      functionName: "claimTokensFor",
      args: [account, 91n, 900n, account],
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: registry,
        functionName: "creditBalanceOf",
        args: [account, 91n],
      }),
    );
    const guard = result.call.preconditions.at(-1)!;
    expect(
      decodeFunctionResult({
        abi: jbTokensAbi,
        functionName: "creditBalanceOf",
        data: guard.expected,
      }),
    ).toBe(900n);
  });

  it.each(["controllerOf", "TOKENS", "tokenOf"])(
    "rejects missing %s before signing",
    async (field) => {
      values[field] = zeroAddress;
      await expect(prepareCreditClaim(client, identity, account)).rejects.toThrow("unavailable");
      expect(simulateContract).not.toHaveBeenCalled();
    },
  );

  it("rejects already-claimed credits", async () => {
    values.creditBalanceOf = 0n;
    await expect(prepareCreditClaim(client, identity, account)).rejects.toThrow(
      "no credits to claim",
    );
  });
});

describe("auto issuance snapshots", () => {
  it("checks the chain's block time and records the live aggregate preset at its own stage ID", async () => {
    const result = await prepareAutoIssuance(client, allocation, account);
    expect(result.amount).toBe(500n);
    expect(result.call).toMatchObject({
      chainId: 10,
      address: revnetOwner,
      functionName: "autoIssueFor",
      args: [91n, 200n, account],
    });
    expect(getBlock).toHaveBeenCalledWith({ blockTag: "latest" });
    expect(result.call.preconditions).toHaveLength(5);
  });

  it("keeps multiple allocations on the same chain", async () => {
    const rows = await Promise.all(
      [allocation, { ...allocation, beneficiary: token }].map((row) =>
        prepareAutoIssuance(client, row, account),
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows.map((row) => row.call.args)).toEqual([
      [91n, 200n, account],
      [91n, 200n, token],
    ]);
    expect(autoIssuanceKey(allocation)).not.toBe(
      autoIssuanceKey({ ...allocation, projectId: 92n }),
    );
  });

  it("rejects a stage that has not started on chain", async () => {
    values.getRulesetOf = [{ ...rawRuleset, start: 101 }, expandedMetadata];
    await expect(prepareAutoIssuance(client, allocation, account)).rejects.toThrow("still locked");
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it("rejects a missing or mismatched stage", async () => {
    values.getRulesetOf = [{ ...rawRuleset, id: 0 }, expandedMetadata];
    await expect(prepareAutoIssuance(client, allocation, account)).rejects.toThrow(
      "stage is unavailable",
    );
  });

  it("rejects a previously consumed allocation", async () => {
    values.amountToAutoIssue = 0n;
    await expect(prepareAutoIssuance(client, allocation, account)).rejects.toThrow(
      "already been distributed",
    );
  });

  it.each(["ownerOf", "CONTROLLER"])("rejects changed %s source identity", async (field) => {
    values[field] = token;
    await expect(prepareAutoIssuance(client, allocation, account)).rejects.toThrow(
      /no longer owned|controller changed/,
    );
    expect(simulateContract).not.toHaveBeenCalled();
  });
});
