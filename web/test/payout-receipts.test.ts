import { type ExpectedPayoutReceipt, verifyPayoutReceipt } from "@/lib/payout-receipts";
import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import {
  type AbiEvent,
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
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
const expected: ExpectedPayoutReceipt = {
  kind: "payout",
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

describe("wallet-action:payouts — recipient completion evidence", () => {
  it("accepts exact reviewed hook, project and owner recipients with the full standard fee", () => {
    expect(() => verifyPayoutReceipt(receipt(), expected)).not.toThrow();
  });

  it("accepts feeless recipients and fee rounding at the one-unit boundary", () => {
    expect(() =>
      verifyPayoutReceipt(
        receipt({
          first: { netAmount: 2_500n },
          second: { netAmount: 5_000n },
          payout: { netLeftoverPayoutAmount: 2_500n, fee: 0n },
        }),
        expected,
      ),
    ).not.toThrow();
    const tinyExpected = { ...expected, amount: "4", minimum: "4" };
    expect(() =>
      verifyPayoutReceipt(
        receipt({
          first: { amount: 1n, netAmount: 1n },
          second: { amount: 2n, netAmount: 2n },
          payout: { amount: 4n, amountPaidOut: 4n, fee: 0n, netLeftoverPayoutAmount: 1n },
        }),
        tinyExpected,
      ),
    ).not.toThrow();
  });

  it("rejects a hook short-pull even though the outer receipt succeeded and emitted no failure event", () => {
    expect(() => verifyPayoutReceipt(receipt({ first: { netAmount: 2_437n } }), expected)).toThrow(
      "do not send these payouts again",
    );
  });

  it("rejects partial owner delivery and excessive fee claims", () => {
    expect(() =>
      verifyPayoutReceipt(receipt({ payout: { netLeftoverPayoutAmount: 2_437n } }), expected),
    ).toThrow();
    expect(() => verifyPayoutReceipt(receipt({ payout: { fee: 251n } }), expected)).toThrow();
  });

  it.each([
    { projectId: 43n },
    { rulesetId: 101n },
    { rulesetCycleNumber: 8n },
    { projectOwner: hook },
    { amount: 10_001n },
    { amountPaidOut: 9_899n },
    { caller: hook },
  ])("rejects payout identity, ruleset, receiver or amount drift case %#", (change) => {
    expect(() => verifyPayoutReceipt(receipt({ payout: change }), expected)).toThrow();
  });

  it.each([
    { percent: 249_999_999 },
    { projectId: 1n },
    { beneficiary: caller },
    { preferAddToBalance: true },
    { lockedUntil: 101 },
    { hook: zeroAddress },
  ])("rejects changed split settings case %#", (change) => {
    expect(() =>
      verifyPayoutReceipt(receipt({ first: { split: { ...split, ...change } } }), expected),
    ).toThrow();
  });

  it("rejects missing, duplicate, out-of-order and forged-emitter split events", () => {
    const valid = receipt();
    expect(() => verifyPayoutReceipt({ logs: valid.logs.slice(1) }, expected)).toThrow();
    expect(() => verifyPayoutReceipt({ logs: [...valid.logs, valid.logs[0]] }, expected)).toThrow();
    expect(() =>
      verifyPayoutReceipt({ logs: [valid.logs[1], valid.logs[0], valid.logs[2]] }, expected),
    ).toThrow();
    expect(() =>
      verifyPayoutReceipt(
        { logs: [{ ...valid.logs[0], address: hook }, ...valid.logs.slice(1)] },
        expected,
      ),
    ).toThrow();
  });

  it("rejects missing or duplicate terminal completion events", () => {
    const valid = receipt();
    expect(() => verifyPayoutReceipt({ logs: valid.logs.slice(0, 2) }, expected)).toThrow();
    expect(() => verifyPayoutReceipt({ logs: [...valid.logs, valid.logs[2]] }, expected)).toThrow();
  });

  it("uses sequential remainder rounding for gross split allocations", () => {
    const odd = { ...expected, amount: "10003", minimum: "10003" };
    const valid = receipt({
      first: { amount: 2_500n },
      second: { amount: 5_002n, netAmount: 4_877n },
      payout: { amount: 10_003n, amountPaidOut: 10_003n, netLeftoverPayoutAmount: 2_439n },
    });
    expect(() => verifyPayoutReceipt(valid, odd)).not.toThrow();
    expect(() => verifyPayoutReceipt(receipt({ first: { amount: 2_501n } }), expected)).toThrow();
  });

  it("rejects both explicit recipient failure events", () => {
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
      expect(() => verifyPayoutReceipt({ logs: [...receipt().logs, failed] }, expected)).toThrow();
    }
  });

  it("ignores unrelated projects and other emitters without accepting them as missing evidence", () => {
    const unrelated = log("SendPayouts", { ...payout, projectId: 99n });
    expect(() =>
      verifyPayoutReceipt(
        { logs: [...receipt().logs, unrelated, log("SendPayouts", payout, hook)] },
        expected,
      ),
    ).not.toThrow();
  });
});
