import { safeRelayrSession } from "@/lib/safe-relayr";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { canReplaceSafeRelayrQuote } from "@bananapus/nana-sdk-core/review/safe-relayr";
import { SAFE_EXEC_ABI, canonicalSafeTxHash } from "@bananapus/nana-sdk-core/safe-service";
import { readFileSync } from "node:fs";
import { encodeFunctionData, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { ACCOUNT, BUNDLE_UUID, HASH, TARGET, TX_UUIDS } from "./relayr-fixtures";

const legacy: TransactionActivity = {
  id: `relayr:${BUNDLE_UUID}`,
  kind: "relayr-bundle",
  title: "Saved Safe bundle",
  status: "pending",
  message: "Waiting",
  account: ACCOUNT,
  bundleUuid: BUNDLE_UUID,
  relayrPaymentStatus: "unfunded",
  relayrExpectedTransactions: [
    {
      chainId: 1,
      target: TARGET,
      data: "0x1234",
      value: "0",
      gas: "100000",
      transactionUuid: TX_UUIDS[0],
      expectedSafeExecution: { safe: TARGET, safeTxHash: HASH, nonce: 7 },
      preconditions: [{ address: TARGET, data: "0x1234", expected: HASH }],
    },
  ],
  createdAt: 1,
  updatedAt: 2,
};

describe("Safe Relayr legacy storage adapter", () => {
  const safeCall = {
    to: TARGET,
    value: 0n,
    data: "0x1234" as const,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: 7,
  };
  const releasedDraft: TransactionActivity = {
    ...legacy,
    id: "sdk-publication",
    relayrSafeSessionId: "sdk-publication",
    title: "Safe execution bundle",
    status: "failed",
    message: "This unpaid Relayr quote expired. Review the action again for a new quote.",
    bundleUuid: undefined,
    relayrExpectedTransactions: [
      {
        ...legacy.relayrExpectedTransactions![0],
        transactionUuid: "",
        data: encodeFunctionData({
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          args: [
            safeCall.to,
            safeCall.value,
            safeCall.data,
            safeCall.operation,
            safeCall.safeTxGas,
            safeCall.baseGas,
            safeCall.gasPrice,
            safeCall.gasToken,
            safeCall.refundReceiver,
            "0x",
          ],
        }),
        expectedSafeExecution: {
          safe: TARGET,
          safeTxHash: canonicalSafeTxHash(1, TARGET, safeCall),
          nonce: 7,
        },
      },
    ],
  };

  it("restores the SDK's explicit release of an unfunded, unpublished review", () => {
    expect(
      safeRelayrSession({
        ...releasedDraft,
        message: "Review canceled before publication.",
        relayrSafeState: "released",
      })?.state,
    ).toBe("released");
  });

  it("recovers the precise pre-publication release written by the earlier adapter", () => {
    expect(safeRelayrSession(releasedDraft)?.state).toBe("released");
  });

  it.each([
    { id: "different-record" },
    { relayrSafeSessionId: undefined },
    { title: "Relayr authorization publication" },
    { status: "pending" as const },
    { message: "The quote response was lost." },
    { bundleUuid: BUNDLE_UUID },
    { relayrQuote: { bundle_uuid: BUNDLE_UUID, payment_info: [] } },
    { hash: HASH },
    { executionHash: HASH },
    { safeProposalHash: HASH },
    { chainId: 1 },
    { chainStates: [{ chainId: 1, status: "Pending", hash: HASH }] },
    { relayrPayment: { target: TARGET, data: "0x" as const, value: "0" } },
    {
      relayrPayments: [{ hash: HASH, chainId: 1, target: TARGET, data: "0x" as const, value: "0" }],
    },
    { relayrSafeFundingUnknown: true },
    { relayrPaymentStatus: "submitted" as const },
    { manualVerificationRequired: true },
    { relayrSafeState: "publishing" as const },
  ])(
    "keeps a possible published or funded attempt reserved when the legacy release evidence differs: %j",
    (patch) => {
      expect(safeRelayrSession({ ...releasedDraft, ...patch })?.state).not.toBe("released");
    },
  );

  it("does not infer a legacy release from invalid Safe calldata or a bound transaction UUID", () => {
    const expected = releasedDraft.relayrExpectedTransactions![0];
    for (const patch of [{ data: "0x1234" as const }, { transactionUuid: TX_UUIDS[0] }]) {
      expect(
        safeRelayrSession({
          ...releasedDraft,
          relayrExpectedTransactions: [{ ...expected, ...patch }],
        })?.state,
      ).not.toBe("released");
    }
  });

  it.each(["relayrPayments", "chainStates", "relayrNonces", "relayrSafeReservationKeys"] as const)(
    "rejects malformed %s without treating it as an empty legacy history",
    (field) => {
      for (const value of [null, {}, { hash: HASH }, { length: 0 }, ""]) {
        const stored = { ...releasedDraft, [field]: value } as unknown as TransactionActivity;
        expect(() => safeRelayrSession(stored)).toThrow(/malformed recovery history/);
        expect(stored[field]).toEqual(value);
      }
    },
  );

  it("retains original call bytes, guards and UUID bindings when a legacy record has no saved fee options", () => {
    const session = safeRelayrSession(legacy)!;
    expect(session.id).toBe(legacy.id);
    expect(session.quote?.payment_info).toEqual([]);
    expect(session.quote?.expectedTransactions[0]).toMatchObject({
      txUuid: TX_UUIDS[0],
      entry: { data: "0x1234", value: "0" },
    });
    expect(session.executions[0].context).toEqual({
      expected: legacy.relayrExpectedTransactions![0],
    });
    expect(session.reservationKeys).toEqual([`1:${TARGET.toLowerCase()}:7`]);
  });

  it("preserves a consumed-nonce release independently of payment status", () => {
    const session = safeRelayrSession({
      ...releasedDraft,
      relayrSafeState: "released",
      relayrSafeReleaseReason: "safe-nonces-consumed",
      message: "Safe transactions are no longer pending.",
    });
    expect(session).toMatchObject({
      state: "released",
      releaseReason: "safe-nonces-consumed",
      paymentStatus: "unfunded",
    });
  });

  it("passes legacy remote execution observations to the shared quote replacement rule", () => {
    const quoteOnly = { ...releasedDraft, relayrSafeState: "publishing" as const };
    expect(canReplaceSafeRelayrQuote(safeRelayrSession(quoteOnly)!)).toBe(true);
    for (const status of ["Running", "Success", "Failed", "unknown", ""]) {
      const session = safeRelayrSession({
        ...quoteOnly,
        chainStates: [{ chainId: 1, status }],
      })!;
      expect(session.records).toEqual([{ chain: 1, status: { state: status, data: undefined } }]);
      expect(canReplaceSafeRelayrQuote(session)).toBe(false);
    }
    expect(
      canReplaceSafeRelayrQuote(
        safeRelayrSession({
          ...quoteOnly,
          chainStates: [{ chainId: 1, status: "Pending" }],
        })!,
      ),
    ).toBe(true);
  });

  it("preserves observed remote funding without a local wallet hash", () => {
    const session = safeRelayrSession({
      ...releasedDraft,
      relayrSafeState: "publishing",
      relayrSafeFundingObserved: true,
    })!;
    expect(session.fundingObserved).toBe(true);
    expect(session.payments).toEqual([]);
    expect(canReplaceSafeRelayrQuote(session)).toBe(false);
  });

  it("marks a partially identified legacy selection incomplete instead of releasing only its known Safe calls", () => {
    const session = safeRelayrSession({
      ...legacy,
      relayrExpectedTransactions: [
        ...legacy.relayrExpectedTransactions!,
        { ...legacy.relayrExpectedTransactions![0], expectedSafeExecution: undefined },
      ],
    })!;
    expect(session.executions).toHaveLength(1);
    expect(session.quote).toBeUndefined();
    expect(session.reservationKeys).toContain(`1:${TARGET.toLowerCase()}:*`);
    expect(
      safeRelayrSession({
        ...legacy,
        relayrSafeReservationKeys: session.reservationKeys,
      })?.reservationKeys,
    ).toContain(`1:${TARGET.toLowerCase()}:*`);
  });

  it.each([
    { hash: HASH },
    { executionHash: HASH },
    { relayrPayment: { target: TARGET, data: "0x" as const, value: "0" } },
    { chainStates: [{ chainId: 1, status: "Pending", hash: HASH }] },
    {
      relayrPayments: [{ hash: HASH, chainId: 1, target: TARGET, data: "0x" as const, value: "0" }],
    },
  ])("preserves contradictory funding evidence as unresolved: %j", (evidence) => {
    const session = safeRelayrSession({
      ...releasedDraft,
      ...evidence,
      relayrSafeState: "released",
    })!;
    expect(session.paymentStatus).toBe("sending");
    expect(session.state).not.toBe("released");
  });

  it("preserves an unresolved Safe reservation even when its exact calls are missing", () => {
    const session = safeRelayrSession({
      ...legacy,
      relayrExpectedTransactions: undefined,
      relayrCallKeys: [
        `${ACCOUNT.toLowerCase()}:relayr-scope:safe-execution:1:${TARGET.toLowerCase()}:7`,
      ],
    })!;
    expect(session.executions).toEqual([]);
    expect(session.state).toBe("active");
    expect(session.quote).toBeUndefined();
    expect(session.reservationKeys).toEqual([`1:${TARGET.toLowerCase()}:7`]);
  });

  it("fails closed for a known Safe journal with a missing account", () => {
    expect(() => safeRelayrSession({ ...legacy, account: undefined })).toThrow(
      /missing its account/,
    );
  });

  it("retains a hashless retry's sending state across reloads despite older payment history", () => {
    const session = safeRelayrSession({
      ...legacy,
      relayrSafeSessionId: "sdk-session",
      relayrSafeFundingUnknown: true,
      relayrPaymentStatus: "submitted",
      hash: HASH,
    });
    expect(session?.paymentStatus).toBe("sending");
    expect(safeRelayrSession({ ...legacy, relayrPaymentStatus: "submitted" })?.paymentStatus).toBe(
      "sending",
    );
    expect(
      safeRelayrSession({
        ...legacy,
        relayrSafeSessionId: "sdk-session",
        relayrSafeFundingUnknown: false,
        relayrPaymentStatus: "submitted",
      })?.paymentStatus,
    ).toBe("submitted");
  });
});

describe("Safe Relayr shared ownership gate", () => {
  it("routes preparation, payment and recovery through the SDK without duplicating its lifecycle", () => {
    const adapter = readFileSync("src/lib/safe-relayr.ts", "utf8");
    const hook = readFileSync("src/hooks/useReviewedRelayr.ts", "utf8");
    expect(adapter).toContain('from "@bananapus/nana-sdk-core/review/safe-relayr"');
    expect(adapter).toContain("createSafeRelayrController({");
    expect(hook).toMatch(
      /safeRelayrController\(\s*config,\s*undefined,\s*options\?\.onProgress,?\s*\)\s*\.prepare\(/,
    );
    expect(hook).toContain("controller = safeRelayrController(config, true);");
    expect(hook).toMatch(/\.fund\(\{/);
    expect(hook).toMatch(/safeBundleController\(wagmiConfig, key\)\.check\(/);
    expect(hook).toMatch(/safeBundleController\(wagmiConfig, bundleUuid\)\s*\.watch\(/);
    expect(adapter).not.toMatch(
      /\b(?:bindRelayrQuote|relayrBundleRequest|relayrDeadlinePassed|verifyRelayrDestinations|requireRelayrBundleUnpaid)\b/,
    );
    expect(hook).not.toMatch(/function (?:sameSafeIntents|safeIntentKey)|requireRawSafeExecution/);
  });
});
