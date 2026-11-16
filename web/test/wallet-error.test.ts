import { TransactionReviewCancelledError } from "@/lib/transaction-review";
import { formatTransactionMessage, formatWalletError } from "@/lib/utils";
import { describe, expect, test } from "vitest";

describe("formatWalletError", () => {
  test("prefers a wallet short message and makes rejection copy user-facing", () => {
    expect(
      formatWalletError({
        shortMessage: "User rejected the request",
        message: "fallback",
      }),
    ).toBe("You rejected the request");
  });

  test("falls back through message, string, and default cases", () => {
    expect(formatWalletError(new Error("insufficient funds"))).toBe("insufficient funds");
    expect(formatWalletError("wallet unavailable")).toBe("wallet unavailable");
    expect(formatWalletError(null, "Try again later")).toBe("Try again later");
    expect(formatWalletError({ message: 123 }, "Try again later")).toBe("Try again later");
  });

  test("keeps a closed review's own message", () => {
    expect(formatWalletError(new TransactionReviewCancelledError())).toBe(
      "Review closed. Nothing was sent.",
    );
    expect(
      formatWalletError(
        new TransactionReviewCancelledError("Funding chain selection cancelled. Nothing was sent."),
      ),
    ).toBe("Funding chain selection cancelled. Nothing was sent.");
  });

  test("explains a service simulation failure without changing its diagnostic evidence", () => {
    const cause = Object.freeze({ status: 406, body: { error: "SimulationReverted", chain: 1 } });
    const error = Object.freeze(
      new Error("Relayr HTTP 406: SimulationReverted on chain 1: GS013", { cause }),
    );
    expect(formatWalletError(error)).toBe("Transaction simulation failed on chain 1: GS013");
    expect(error.message).toBe("Relayr HTTP 406: SimulationReverted on chain 1: GS013");
    expect(error.cause).toBe(cause);
  });

  test("keeps transport failures distinct from a simulation failure", () => {
    expect(formatWalletError(new Error("Relayr HTTP 503: TemporarilyUnavailable"))).toBe(
      "Transaction request failed (HTTP 503): TemporarilyUnavailable",
    );
  });

  test.each([
    ["Relayr multi-chain bundle", "Multi-chain bundle"],
    [
      "The saved batch contains a Relayr authorization.",
      "The saved batch contains an authorization.",
    ],
    [
      "The Relayr entry does not match its Safe execution.",
      "The entry does not match its Safe execution.",
    ],
    [
      "Relayr Safe executions must not reimburse an executor from Safe funds.",
      "Safe executions must not reimburse an executor from Safe funds.",
    ],
    [
      "This unpaid Relayr quote expired. Review the action again for a new quote.",
      "This unpaid quote expired. Review the action again for a new quote.",
    ],
    [
      "Relayr reported a failed destination transaction. Do not pay again.",
      "The network reported a failed destination transaction. Do not pay again.",
    ],
    [
      "Relayr's response does not match the signed bundle. Do not pay again.",
      "The response does not match the signed bundle. Do not pay again.",
    ],
    [
      "Relayr funding is being submitted. Do not pay again while the wallet result is uncertain.",
      "Funding is being submitted. Do not pay again while the wallet result is uncertain.",
    ],
  ])("formats saved transaction copy without inventing a payment result: %s", (saved, visible) => {
    expect(formatTransactionMessage(saved)).toBe(visible);
    expect(formatTransactionMessage(visible)).toBe(visible);
    expect(formatWalletError(saved)).toBe(visible);
  });

  test("preserves technical references and unrelated casing", () => {
    for (const text of [
      "https://relayr.example/bundle/1",
      "RelayrRecoveryError",
      "insufficient funds",
    ])
      expect(formatTransactionMessage(text)).toBe(text);
  });
});
