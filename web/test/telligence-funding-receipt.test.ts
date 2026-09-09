import { assertComputePaymentReceipt } from "@/lib/telligence/funding-receipt";
import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseAbiParameters,
  toEventSelector,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { describe, expect, it } from "vitest";

const terminal = "0x1111111111111111111111111111111111111111" as const;
const supporter = "0x2222222222222222222222222222222222222222" as const;
const other = "0x3333333333333333333333333333333333333333" as const;
const expected = { terminal, projectId: 42n, supporter, amount: 2n * 10n ** 18n };
type PayLog = Pick<Log, "address" | "data" | "topics">;

function payLog(
  change: Partial<{
    address: Address;
    projectId: bigint;
    payer: Address;
    beneficiary: Address;
    amount: bigint;
    newlyIssuedTokenCount: bigint;
    caller: Address;
  }> = {},
): PayLog {
  const fields = {
    address: terminal,
    projectId: expected.projectId,
    payer: supporter,
    beneficiary: supporter,
    amount: expected.amount,
    newlyIssuedTokenCount: 7n * 10n ** 18n,
    caller: supporter,
    ...change,
  };
  const [signature, ...indexed] = encodeEventTopics({
    abi: jbMultiTerminalAbi,
    eventName: "Pay",
    args: { rulesetId: 1n, rulesetCycleNumber: 1n, projectId: fields.projectId },
  });
  const topics: [Hex, ...Hex[]] = [
    signature,
    ...indexed.map((topic) => {
      if (typeof topic !== "string") throw new Error("Mined logs need exact topics.");
      return topic;
    }),
  ];
  const data = encodeAbiParameters(
    parseAbiParameters(
      "address payer,address beneficiary,uint256 amount,uint256 newlyIssuedTokenCount,string memo,bytes metadata,address caller",
    ),
    [
      fields.payer,
      fields.beneficiary,
      fields.amount,
      fields.newlyIssuedTokenCount,
      "Support compute",
      "0x",
      fields.caller,
    ],
  );
  return { address: fields.address, topics, data };
}

const successful = (logs: readonly PayLog[]) => ({ status: "success", logs });

describe("compute funding receipt evidence", () => {
  it("accepts one exact payment from the pinned VVV-only terminal project", () => {
    expect(() => assertComputePaymentReceipt(successful([payLog()]), expected)).not.toThrow();
  });

  it("does not require new issuance when the standard buyback route supplies the supporter tokens", () => {
    expect(() =>
      assertComputePaymentReceipt(successful([payLog({ newlyIssuedTokenCount: 0n })]), expected),
    ).not.toThrow();
  });

  it("accepts relayed caller identities when the event still binds the actual payer and beneficiary", () => {
    expect(() =>
      assertComputePaymentReceipt(successful([payLog({ caller: other })]), expected),
    ).not.toThrow();
  });

  it("rejects a reverted transaction even if its supplied logs resemble a payment", () => {
    expect(() =>
      assertComputePaymentReceipt({ status: "reverted", logs: [payLog()] }, expected),
    ).toThrow(/revert|succeed/i);
  });

  it("rejects outer Safe success when the terminal payment failed or was never executed", () => {
    expect(() => assertComputePaymentReceipt(successful([]), expected)).toThrow(
      /payment|matching/i,
    );
    const executionSuccess = {
      address: supporter,
      topics: [`0x${"ab".repeat(32)}`] as [Hex],
      data: "0x" as Hex,
    };
    expect(() => assertComputePaymentReceipt(successful([executionSuccess]), expected)).toThrow(
      /payment|matching/i,
    );
  });

  it.each([
    ["terminal", { address: other }],
    ["project", { projectId: 43n }],
    ["payer", { payer: other }],
    ["beneficiary", { beneficiary: other }],
    ["amount", { amount: expected.amount - 1n }],
  ] as const)(
    "rejects a receipt whose %s differs from the reviewed contribution",
    (_field, change) => {
      expect(() => assertComputePaymentReceipt(successful([payLog(change)]), expected)).toThrow(
        /payment|matching/i,
      );
    },
  );

  it("rejects multiple exact matches instead of guessing which payment fulfilled the review", () => {
    expect(() => assertComputePaymentReceipt(successful([payLog(), payLog()]), expected)).toThrow(
      /unique|matching|payment/i,
    );
  });

  it("ignores unrelated events when exactly one contribution matches", () => {
    expect(() =>
      assertComputePaymentReceipt(
        successful([payLog({ address: other }), payLog({ projectId: 43n }), payLog()]),
        expected,
      ),
    ).not.toThrow();
  });

  it("rejects malformed Pay bytes rather than accepting its event topic alone", () => {
    expect(() =>
      assertComputePaymentReceipt(successful([{ ...payLog(), data: "0x" }]), expected),
    ).toThrow(/payment|matching/i);
    expect(() =>
      assertComputePaymentReceipt(successful([{ ...payLog(), topics: [] }]), expected),
    ).toThrow(/payment|matching/i);
  });

  it("uses the exact Pay event fields and indexing published by IJBTerminal", () => {
    const published = parseAbi([
      "event Pay(uint256 indexed rulesetId,uint256 indexed rulesetCycleNumber,uint256 indexed projectId,address payer,address beneficiary,uint256 amount,uint256 newlyIssuedTokenCount,string memo,bytes metadata,address caller)",
    ])[0];
    const generated = jbMultiTerminalAbi.find(
      (item) => item.type === "event" && item.name === "Pay",
    );
    if (!generated || generated.type !== "event")
      throw new Error("Terminal ABI is missing its Pay event.");
    expect(toEventSelector(generated)).toBe(toEventSelector(published));
    expect(generated.inputs.map(({ type, indexed }) => ({ type, indexed }))).toEqual(
      published.inputs.map((input) => ({
        type: input.type,
        indexed: "indexed" in input ? input.indexed : false,
      })),
    );
  });
});
