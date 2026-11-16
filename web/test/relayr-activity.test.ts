import { relayrSavedQuote, sentPayments } from "@/lib/relayr-activity";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { relayrSentPaymentsSnapshot } from "@bananapus/nana-sdk-core/review/relayr";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT,
  BUNDLE_UUID,
  HASH,
  NOW,
  PAYMENT_TARGET,
  TARGET,
  payment,
} from "./relayr-fixtures";

const SECOND_HASH = `0x${"5e".repeat(32)}` as Hex;

/** A saved Relayr session as the app stores one: two destinations and a quote with an option on each chain. */
function session(overrides: Partial<TransactionActivity> = {}): TransactionActivity {
  return {
    id: `relayr:${BUNDLE_UUID}`,
    kind: "relayr-bundle",
    title: "Relayr bundle",
    status: "failed",
    message: "",
    createdAt: 0,
    updatedAt: 0,
    account: ACCOUNT,
    bundleUuid: BUNDLE_UUID,
    relayrExpectedTransactions: [
      { chainId: 1, target: TARGET, data: "0x1234", value: "0", transactionUuid: "first" },
      { chainId: 10, target: TARGET, data: "0x1234", value: "0", transactionUuid: "second" },
    ],
    relayrQuote: { bundle_uuid: BUNDLE_UUID, payment_info: [payment(), payment({ chain: 10 })] },
    ...overrides,
  };
}

/** A payment as the app saves one: the SDK's `calldata` is its `data`, and its `amount` its `value`. */
function sent(hash: Hex, option = payment()) {
  return {
    hash,
    chainId: option.chain,
    target: option.target,
    data: option.calldata,
    value: "16",
  };
}

describe("a saved Relayr session read as the SDK's saved quote", () => {
  it("reads each sent payment with its calldata's deadline word and the bundle it pays for", () => {
    const later = payment({ chain: 10 }, { deadline: NOW + 900 });
    const { payments } = relayrSavedQuote(
      session({ relayrPayments: [sent(HASH), sent(SECOND_HASH, later)] }),
    );
    expect(payments).toEqual([
      {
        hash: HASH,
        chainId: 1,
        target: PAYMENT_TARGET,
        calldata: payment().calldata,
        amount: "16",
        deadline: String(NOW + 600),
        bundleUuid: BUNDLE_UUID,
      },
      {
        hash: SECOND_HASH,
        chainId: 10,
        target: PAYMENT_TARGET,
        calldata: later.calldata,
        amount: "16",
        deadline: String(NOW + 900),
        bundleUuid: BUNDLE_UUID,
      },
    ]);
    // The SDK's strict read of a saved list accepts it unchanged.
    expect(relayrSentPaymentsSnapshot(payments)).toEqual(payments);
  });

  it("takes a payment's deadline from its calldata, never from its quote's option", () => {
    const { payments, options } = relayrSavedQuote(
      session({
        relayrPayments: [sent(HASH)],
        relayrQuote: {
          bundle_uuid: BUNDLE_UUID,
          payment_info: [payment({ payment_deadline: String(NOW + 5) })],
        },
      }),
    );
    expect(options[0].payment_deadline).toBe(String(NOW + 5));
    expect(payments[0].deadline).toBe(String(NOW + 600));
  });

  it("names the one payment of a row that lists none by its hash", () => {
    const row = session({
      hash: HASH,
      chainId: 1,
      relayrPayment: { target: PAYMENT_TARGET, data: payment().calldata, value: "16" },
    });
    expect(sentPayments(row)).toEqual([sent(HASH)]);
    expect(relayrSavedQuote(row).payments).toEqual([
      expect.objectContaining({
        hash: HASH,
        chainId: 1,
        amount: "16",
        calldata: payment().calldata,
      }),
    ]);
    // A row with a journal is read from the journal alone.
    expect(sentPayments({ ...row, relayrPayments: [sent(SECOND_HASH)] })).toEqual([
      sent(SECOND_HASH),
    ]);
    expect(sentPayments(session())).toEqual([]);
    expect(sentPayments(undefined)).toEqual([]);
  });

  it("reads the bundle ID in lower case, as the SDK keeps it", () => {
    const saved = relayrSavedQuote(
      session({ bundleUuid: BUNDLE_UUID.toUpperCase(), relayrPayments: [sent(HASH)] }),
    );
    expect(saved.bundleUuid).toBe(BUNDLE_UUID);
    expect(saved.payments[0].bundleUuid).toBe(BUNDLE_UUID);
    expect(relayrSentPaymentsSnapshot(saved.payments)).toEqual(saved.payments);
  });

  it.each<[string, Hex]>([
    ["calldata that is not payment calldata", "0x1234"],
    ["calldata that is not hex", `0x${"zz".repeat(68)}` as Hex],
  ])("reads %s as a payment the SDK refuses, without throwing", (_, data) => {
    const { payments } = relayrSavedQuote(session({ relayrPayments: [{ ...sent(HASH), data }] }));
    expect(payments).toHaveLength(1);
    expect(relayrSentPaymentsSnapshot(payments)).toBeNull();
  });

  it("carries the quote's options, its destination chains and the account the payments were sent from", () => {
    expect(relayrSavedQuote(session())).toEqual({
      bundleUuid: BUNDLE_UUID,
      payments: [],
      options: [payment(), payment({ chain: 10 })],
      destinationChainIds: [1, 10],
      account: ACCOUNT,
    });
    expect(
      relayrSavedQuote(
        session({
          bundleUuid: undefined,
          account: undefined,
          relayrQuote: undefined,
          relayrExpectedTransactions: undefined,
        }),
      ),
    ).toEqual({ bundleUuid: "", payments: [], options: [], destinationChainIds: [], account: "" });
  });
});
