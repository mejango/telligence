import { verifyActionReceipt } from "@/lib/multichain-guards";
import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import type { ExpectedPayoutReceipt } from "@bananapus/nana-sdk-core/v6";
import {
  type AbiEvent,
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type PublicClient,
  type TransactionReceipt,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";

const terminal = "0x0000000000000000000000000000000000000011" as Address;
const token = "0x0000000000000000000000000000000000000012" as Address;
const owner = "0x0000000000000000000000000000000000000013" as Address;
const caller = "0x0000000000000000000000000000000000000014" as Address;
const hook = "0x0000000000000000000000000000000000000015" as Address;
const split = {
  percent: 250_000_000,
  projectId: 0n,
  beneficiary: owner,
  preferAddToBalance: false,
  lockedUntil: 100,
  hook,
};
// As the payouts card journals it: JSON-safe, with the reviewed splits in order.
const expected: ExpectedPayoutReceipt = {
  terminal,
  token,
  owner,
  caller,
  projectId: "42",
  rulesetId: "100",
  cycleNumber: "7",
  amount: "10000",
  minimum: "9900",
  splits: [
    { ...split, projectId: "0" },
    { ...split, percent: 500_000_000, hook: zeroAddress, projectId: "5", preferAddToBalance: true },
  ],
};

function log(
  name: string,
  args: Record<string, unknown>,
  address = terminal,
): TransactionReceipt["logs"][number] {
  const event = jbMultiTerminalAbi.find(
    (item) => item.type === "event" && item.name === name,
  ) as AbiEvent;
  const unindexed = event.inputs.filter((input) => !input.indexed);
  return {
    address,
    topics: encodeEventTopics({ abi: [event], eventName: name, args }),
    data: encodeAbiParameters(
      unindexed,
      unindexed.map((input) => args[input.name!]),
    ),
  } as TransactionReceipt["logs"][number];
}

const payout = {
  rulesetId: 100n,
  rulesetCycleNumber: 7n,
  projectId: 42n,
  projectOwner: owner,
  amount: 10_000n,
  amountPaidOut: 10_000n,
  fee: 249n,
  netLeftoverPayoutAmount: 2_438n,
  caller,
};
const first = {
  projectId: 42n,
  rulesetId: 100n,
  group: BigInt(token),
  split,
  amount: 2_500n,
  netAmount: 2_438n,
  caller,
};
const second = {
  ...first,
  split: {
    ...split,
    percent: 500_000_000,
    projectId: 5n,
    preferAddToBalance: true,
    hook: zeroAddress,
  },
  amount: 5_000n,
  netAmount: 4_875n,
};
function receipt(
  options: {
    first?: Partial<typeof first>;
    second?: Partial<typeof second>;
    payout?: Partial<typeof payout>;
  } = {},
) {
  return {
    logs: [
      log("SendPayoutToSplit", { ...first, ...options.first }),
      log("SendPayoutToSplit", { ...second, ...options.second }),
      log("SendPayouts", { ...payout, ...options.payout }),
    ],
  };
}

/** What the batch and Relayr verifiers run on a payout's receipt. */
function verify(result: { logs: TransactionReceipt["logs"] }, review = expected) {
  return verifyActionReceipt(
    {} as PublicClient,
    result as TransactionReceipt,
    terminal,
    undefined,
    [],
    undefined,
    review,
  );
}

describe("recipient completion evidence", () => {
  it("wallet-action:payouts accepts exact reviewed hook, project and owner recipients with the full standard fee", async () => {
    await expect(verify(receipt())).resolves.toBeUndefined();
  });

  it("accepts feeless recipients and fee rounding at the one-unit boundary", async () => {
    await expect(
      verify(
        receipt({
          first: { netAmount: 2_500n },
          second: { netAmount: 5_000n },
          payout: { netLeftoverPayoutAmount: 2_500n, fee: 0n },
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verify(
        receipt({
          first: { amount: 1n, netAmount: 1n },
          second: { amount: 2n, netAmount: 2n },
          payout: { amount: 4n, amountPaidOut: 4n, fee: 0n, netLeftoverPayoutAmount: 1n },
        }),
        { ...expected, amount: "4", minimum: "4" },
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a hook that took only part of its share, though the receipt succeeded", async () => {
    await expect(verify(receipt({ first: { netAmount: 2_437n } }))).rejects.toThrow(
      "do not send these payouts again",
    );
    // Its net is its gross, or its gross less the 2.5% fee: nothing in between.
    await expect(verify(receipt({ first: { netAmount: 2_450n } }))).rejects.toThrow(
      "received 2,450 of its 2,500",
    );
  });

  it("rejects partial owner delivery and excessive fee claims", async () => {
    await expect(
      verify(receipt({ payout: { netLeftoverPayoutAmount: 2_437n } })),
    ).rejects.toThrow();
    await expect(verify(receipt({ payout: { fee: 251n } }))).rejects.toThrow();
  });

  it.each([
    { projectId: 43n },
    { rulesetId: 101n },
    { rulesetCycleNumber: 8n },
    { projectOwner: hook },
    { amount: 10_001n },
    { amountPaidOut: 9_899n },
    { caller: hook },
  ])("rejects payout identity, ruleset, receiver or amount drift case %#", async (change) => {
    await expect(verify(receipt({ payout: change }))).rejects.toThrow();
  });

  it.each([
    { percent: 249_999_999 },
    { projectId: 1n },
    { beneficiary: caller },
    { preferAddToBalance: true },
    { lockedUntil: 101 },
    { hook: zeroAddress },
  ])("rejects changed split settings case %#", async (change) => {
    await expect(verify(receipt({ first: { split: { ...split, ...change } } }))).rejects.toThrow();
  });

  it("rejects a receipt missing a split's event, and duplicate, reordered or forged ones", async () => {
    const valid = receipt();
    await expect(verify({ logs: valid.logs.slice(1) })).rejects.toThrow(
      "the receipt pays 1 splits, not the reviewed 2",
    );
    await expect(verify({ logs: [...valid.logs, valid.logs[0]] })).rejects.toThrow();
    await expect(verify({ logs: [valid.logs[1], valid.logs[0], valid.logs[2]] })).rejects.toThrow();
    await expect(
      verify({ logs: [{ ...valid.logs[0], address: hook }, ...valid.logs.slice(1)] }),
    ).rejects.toThrow();
  });

  it("rejects missing or duplicate terminal completion events", async () => {
    const valid = receipt();
    await expect(verify({ logs: valid.logs.slice(0, 2) })).rejects.toThrow();
    await expect(verify({ logs: [...valid.logs, valid.logs[2]] })).rejects.toThrow();
  });

  it("uses sequential remainder rounding for gross split allocations", async () => {
    await expect(
      verify(
        receipt({
          first: { amount: 2_500n },
          second: { amount: 5_002n, netAmount: 4_877n },
          payout: { amount: 10_003n, amountPaidOut: 10_003n, netLeftoverPayoutAmount: 2_439n },
        }),
        { ...expected, amount: "10003", minimum: "10003" },
      ),
    ).resolves.toBeUndefined();
    await expect(verify(receipt({ first: { amount: 2_501n } }))).rejects.toThrow();
  });

  it("rejects both explicit recipient failure events", async () => {
    const reverted = log("PayoutReverted", {
      projectId: 42n,
      split,
      amount: 2_500n,
      reason: "0x",
      caller,
    });
    const transferReverted = log("PayoutTransferReverted", {
      projectId: 42n,
      addr: owner,
      token,
      amount: 2_438n,
      fee: 62n,
      reason: "0x",
      caller,
    });
    for (const failed of [reverted, transferReverted]) {
      await expect(verify({ logs: [...receipt().logs, failed] })).rejects.toThrow(
        "a recipient failed",
      );
    }
  });

  it("refuses a terminal log its ABI cannot read rather than skipping it", async () => {
    const unreadable = { ...receipt().logs[0], data: "0x" as const };
    await expect(verify({ logs: [...receipt().logs, unreadable] })).rejects.toThrow(
      "that its ABI cannot read",
    );
  });

  it("ignores unrelated projects and other emitters without accepting them as missing evidence", async () => {
    const unrelated = log("SendPayouts", { ...payout, projectId: 99n });
    await expect(
      verify({ logs: [...receipt().logs, unrelated, log("SendPayouts", payout, hook)] }),
    ).resolves.toBeUndefined();
  });
});
