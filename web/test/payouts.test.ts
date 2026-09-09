import {
  buildPayoutCall,
  payoutAmount,
  payoutCurrencyLabel,
  payoutRecipients,
  payoutTokenAmount,
  readPayoutOptions,
} from "@/app/[slug]/components/v6/owners/settlement/payouts";
import {
  jbControllerAbi,
  jbDirectoryAbi,
  jbFundAccessLimitsAbi,
  jbMultiTerminalAbi,
  jbPricesAbi,
  jbProjectsAbi,
  jbRulesetsAbi,
  jbSplitsAbi,
  jbTerminalStoreAbi,
} from "@bananapus/nana-sdk-core";
import {
  type Abi,
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  type Hex,
  type PublicClient,
  toEventSelector,
  zeroAddress,
} from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[slug]/components/v6/owners/settlement/lib", () => ({
  tokenSymbolOf: vi.fn().mockResolvedValue("USDC"),
}));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: vi.fn() }));

const controller = "0x0000000000000000000000000000000000000011" as Address;
const terminal = "0x0000000000000000000000000000000000000012" as Address;
const store = "0x0000000000000000000000000000000000000013" as Address;
const splitsAddress = "0x0000000000000000000000000000000000000014" as Address;
const owner = "0x0000000000000000000000000000000000000015" as Address;
const token = "0x0000000000000000000000000000000000000016" as Address;
const caller = "0x0000000000000000000000000000000000000017" as Address;
const limits = "0x0000000000000000000000000000000000000018" as Address;
const rulesets = "0x0000000000000000000000000000000000000019" as Address;
const projects = "0x0000000000000000000000000000000000000020" as Address;
const prices = "0x0000000000000000000000000000000000000021" as Address;
const abi: Abi = [
  ...jbDirectoryAbi,
  ...jbControllerAbi,
  ...jbMultiTerminalAbi,
  ...jbTerminalStoreAbi,
  ...jbFundAccessLimitsAbi,
  ...jbProjectsAbi,
  ...jbRulesetsAbi,
  ...jbSplitsAbi,
  ...jbPricesAbi,
];
const project = { chainId: 8453 as const, projectId: 42n };
const split = {
  percent: 250_000_000,
  projectId: 0n,
  beneficiary: zeroAddress,
  preferAddToBalance: false,
  lockedUntil: 123,
  hook: zeroAddress,
};

function fixture(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    controllerOf: controller,
    terminalsOf: [terminal],
    FUND_ACCESS_LIMITS: limits,
    accountingContextsOf: [{ token, decimals: 6, currency: 2 }],
    STORE: store,
    SPLITS: splitsAddress,
    PROJECTS: projects,
    ownerOf: owner,
    RULESETS: rulesets,
    currentOf: {
      id: 100,
      cycleNumber: 7,
      basedOnId: 0,
      start: 100,
      duration: 100,
      weight: 1n,
      weightCutPercent: 0,
      approvalHook: zeroAddress,
      metadata: 0n,
    },
    balanceOf: 20_000_000n,
    payoutLimitsOf: [{ amount: 100_000_000n, currency: 2 }],
    splitsOf: [split],
    usedPayoutLimitOf: 10_000_000n,
    PRICES: prices,
    pricePerUnitOf: 10n ** 18n,
    ...overrides,
  };
  const requests: {
    to: Address;
    functionName: string;
    args: readonly unknown[];
    blockNumber: bigint;
  }[] = [];
  const call = vi.fn(
    async ({ to, data, blockNumber }: { to: Address; data: Hex; blockNumber: bigint }) => {
      const decoded = decodeFunctionData({ abi, data });
      requests.push({
        to,
        functionName: decoded.functionName,
        args: decoded.args ?? [],
        blockNumber,
      });
      const value = values[decoded.functionName];
      if (value instanceof Error) throw value;
      return {
        data: encodeFunctionResult({ abi, functionName: decoded.functionName, result: value }),
      };
    },
  );
  return {
    client: { call, getBlockNumber: vi.fn().mockResolvedValue(999n) } as unknown as Pick<
      PublicClient,
      "call" | "getBlockNumber"
    >,
    requests,
    values,
  };
}

describe("wallet-action:payouts — live multichain payouts", () => {
  it("resolves migrated controllers and terminal dependencies at one block, preserving chain project IDs and cycles", async () => {
    const { client, requests } = fixture();
    const [option] = await readPayoutOptions(client, project);
    expect(option).toMatchObject({
      chainId: 8453,
      projectId: 42n,
      terminal,
      token,
      decimals: 6,
      currency: 2,
      rulesetId: 100,
      cycleNumber: 7,
      owner,
      remainingLimit: 90_000_000n,
      availableAmount: 20_000_000n,
    });
    expect(requests.every((request) => request.blockNumber === 999n)).toBe(true);
    expect(requests).toContainEqual({
      to: controller,
      functionName: "FUND_ACCESS_LIMITS",
      args: [],
      blockNumber: 999n,
    });
    expect(requests).toContainEqual({
      to: limits,
      functionName: "payoutLimitsOf",
      args: [42n, 100n, terminal, token],
      blockNumber: 999n,
    });
    expect(requests).toContainEqual({
      to: store,
      functionName: "usedPayoutLimitOf",
      args: [terminal, 42n, token, 7n, 2n],
      blockNumber: 999n,
    });
    expect(option.preconditions).toHaveLength(requests.length);
    expect(option.preconditions.every((guard) => guard.expected !== "0x")).toBe(true);
  });

  it("reads the terminal-token split group including the resolved default splits", async () => {
    const { client, requests } = fixture();
    const [option] = await readPayoutOptions(client, project);
    expect(requests).toContainEqual({
      to: splitsAddress,
      functionName: "splitsOf",
      args: [42n, 100n, BigInt(token)],
      blockNumber: 999n,
    });
    expect(option.splits).toEqual([split]);
    expect(payoutRecipients(option, caller)).toEqual([
      `25% to caller ${caller}`,
      `75% to project owner ${owner}`,
    ]);
  });

  it("preserves project and hook receivers plus add-to-balance behavior", async () => {
    const { client } = fixture({
      splitsOf: [
        {
          ...split,
          percent: 500_000_000,
          projectId: 5n,
          beneficiary: owner,
          preferAddToBalance: true,
        },
        { ...split, percent: 500_000_000, hook: terminal },
      ],
    });
    const [option] = await readPayoutOptions(client, project);
    expect(payoutRecipients(option, caller)).toEqual([
      `50% to project #5 (add to balance; tokens to ${owner})`,
      `50% to hook ${terminal}`,
    ]);
  });

  it("caps by remaining limit and handles an already exhausted limit without underflow", async () => {
    const limited = fixture({ usedPayoutLimitOf: 95_000_000n });
    const exhausted = fixture({ usedPayoutLimitOf: 110_000_000n });
    expect((await readPayoutOptions(limited.client, project))[0].availableAmount).toBe(5_000_000n);
    expect((await readPayoutOptions(exhausted.client, project))[0].availableAmount).toBe(0n);
  });

  it("converts a currency limit into terminal tokens using the actual store price and decimals", async () => {
    const { client, requests } = fixture({
      accountingContextsOf: [{ token, decimals: 18, currency: 1 }],
      balanceOf: 2n * 10n ** 18n,
      payoutLimitsOf: [{ amount: 10_000n * 10n ** 18n, currency: 2 }],
      usedPayoutLimitOf: 0n,
      pricePerUnitOf: 2_000n * 10n ** 18n,
    });
    const [option] = await readPayoutOptions(client, project, vi.fn().mockResolvedValue("ETH"));
    expect(option.availableAmount).toBe(4_000n * 10n ** 18n);
    expect(payoutCurrencyLabel(option)).toBe("USD");
    expect(payoutTokenAmount(option, 2_000n * 10n ** 18n)).toBe(10n ** 18n);
    expect(requests).toContainEqual({
      to: prices,
      functionName: "pricePerUnitOf",
      args: [42n, 2n, 1n, 18n],
      blockNumber: 999n,
    });
    expect(buildPayoutCall(option, "2000", "0.99", caller).args).toEqual([
      42n,
      token,
      2_000n * 10n ** 18n,
      2n,
      990_000_000_000_000_000n,
    ]);
  });

  it.each(["controllerOf", "payoutLimitsOf", "balanceOf", "splitsOf"])(
    "fails closed if %s cannot be read",
    async (field) => {
      const { client } = fixture({ [field]: new Error("RPC unavailable") });
      await expect(readPayoutOptions(client, project)).rejects.toThrow("RPC unavailable");
    },
  );

  it("builds the exact forwarded destination, protected minimum and source guards", async () => {
    const { client } = fixture();
    const [option] = await readPayoutOptions(client, project);
    const call = buildPayoutCall(option, "12.5", "12.375", caller);
    expect(call).toMatchObject({
      address: terminal,
      chainId: 8453,
      functionName: "sendPayoutsOf",
      relayrMode: "forwarded",
      args: [42n, token, 12_500_000n, 2n, 12_375_000n],
    });
    expect(call.preconditions).toEqual(option.preconditions);
    expect(call.rejectEvents.map((event) => event.topic)).toEqual([
      toEventSelector(getAbiItem({ abi: jbMultiTerminalAbi, name: "PayoutReverted" })),
      toEventSelector(getAbiItem({ abi: jbMultiTerminalAbi, name: "PayoutTransferReverted" })),
    ]);
    expect(call.rejectEvents.every((event) => event.address === terminal)).toBe(true);
  });

  it("rejects zero minimums, excessive amounts, and minima larger than the expected payout", async () => {
    const { client } = fixture();
    const [option] = await readPayoutOptions(client, project);
    expect(() => buildPayoutCall(option, "1", "0", caller)).toThrow("greater than zero");
    expect(() => buildPayoutCall(option, "21", "20", caller)).toThrow(
      "exceeds the remaining limit",
    );
    expect(() => buildPayoutCall(option, "1", "2", caller)).toThrow("minimum exceeds");
  });

  it.each(["1.0000001", "-1", "NaN", "1e6", "", "0"])(
    "rejects ambiguous or rounded amount %s",
    (input) => {
      expect(() => payoutAmount(input, 6)).toThrow();
    },
  );
});
