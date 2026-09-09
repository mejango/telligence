import {
  isSafeProposalPendingError,
  requireOnchainExecution,
  SafeProposalPendingError,
} from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity } from "@/lib/transaction-activity";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

const SAFE_HASH = `0x${"12".repeat(32)}` as Hex;
const CONFIRMED_HASH = `0x${"34".repeat(32)}` as Hex;

describe("Safe proposal execution boundary", () => {
  it("never treats an asynchronous Safe proposal as onchain execution", () => {
    recordTransactionActivity({
      id: "safe:test",
      kind: "safe",
      title: "Approve",
      status: "safe-proposed",
      message: "Awaiting Safe approvals",
      hash: SAFE_HASH,
    });

    expect(() => requireOnchainExecution(SAFE_HASH, "Token approval")).toThrow(
      SafeProposalPendingError,
    );
    try {
      requireOnchainExecution(SAFE_HASH, "Token approval");
    } catch (error) {
      expect(isSafeProposalPendingError(error)).toBe(true);
      expect((error as Error).message).toContain("has not executed");
      expect((error as Error).message).toContain("do not submit it again");
    }
  });

  it("allows a confirmed direct transaction to feed a dependent step", () => {
    recordTransactionActivity({
      id: "direct:test",
      kind: "direct",
      title: "Approve",
      status: "success",
      message: "Confirmed",
      hash: CONFIRMED_HASH,
    });

    expect(() => requireOnchainExecution(CONFIRMED_HASH, "Token approval")).not.toThrow();
  });
});
