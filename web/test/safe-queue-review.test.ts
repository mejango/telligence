import { protocolQueueLabel } from "@/lib/protocol-queue-label";
import { queuedSafeReviewCall } from "@/lib/safe-queue-review";
import {
  encodeMultiSend,
  MULTI_SEND_ABI,
  MULTI_SEND_CALL_ONLY,
} from "@bananapus/nana-sdk-core/safe";
import { encodeFunctionData, encodePacked, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { queuedRolloutSteps } from "./fixtures/queued-rollout";

const unknown = {
  to: "0x1111111111111111111111111111111111111111",
  data: "0x12345678",
  value: 17n,
} as const;

describe("queued Safe review metadata", () => {
  it.each([1, 10, 8453, 42161])(
    "decodes the queued rollout's exact ordered actions on chain %s",
    (chainId) => {
      const steps = queuedRolloutSteps(chainId);
      const tx = {
        to: MULTI_SEND_CALL_ONLY,
        data: encodeMultiSend(steps),
        operation: 1,
        value: "0",
      };
      const review = queuedSafeReviewCall(chainId, tx);
      expect(review).toMatchObject({ chainId, to: tx.to, data: tx.data, value: 0n });
      expect(review.calls).toHaveLength(3);
      steps.forEach((step, index) => {
        expect(review.calls![index]).toMatchObject({
          chainId,
          to: step.to,
          data: step.data,
          value: 0n,
          abi: step.abi,
          functionName: step.functionName,
          args:
            index === 1
              ? [2n, 3000, 60, 1800n, "0x0000000000000000000000000000000000000000"]
              : step.args,
          label: protocolQueueLabel(chainId, { ...step, operation: 0 }),
        });
      });
    },
  );

  it("retains unknown calls and native value in their original batch position", () => {
    const step = queuedRolloutSteps()[0]!;
    const review = queuedSafeReviewCall(8453, {
      to: MULTI_SEND_CALL_ONLY,
      data: encodeMultiSend([step, unknown, step]),
      operation: 1,
    });
    expect(review.calls).toHaveLength(3);
    expect(review.calls![1]).toMatchObject({ chainId: 8453, ...unknown });
    expect(review.calls![1].abi).toBeUndefined();
    expect(review.calls![1].functionName).toBeUndefined();
  });

  it("decodes direct protocol calls without inventing nested calls", () => {
    const step = queuedRolloutSteps()[0]!;
    const review = queuedSafeReviewCall(8453, { ...step, operation: 0 });
    expect(review).toMatchObject({
      abi: step.abi,
      functionName: step.functionName,
      args: step.args,
    });
    expect(review.calls).toBeUndefined();
    const delegated = queuedSafeReviewCall(8453, { ...step, operation: 1 });
    expect(delegated.abi).toBeUndefined();
  });

  it("preserves a native transfer with absent calldata", () => {
    expect(
      queuedSafeReviewCall(8453, { ...unknown, data: null, operation: 0, value: "17" }),
    ).toMatchObject({ chainId: 8453, to: unknown.to, data: "0x", value: 17n });
  });

  const valid = encodeMultiSend([unknown]);
  const nonCall = encodeFunctionData({
    abi: MULTI_SEND_ABI,
    functionName: "multiSend",
    args: [
      encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [1, unknown.to, 0n, 4n, unknown.data],
      ),
    ],
  });
  it.each([
    ["truncated calldata", valid.slice(0, -2) as Hex],
    ["trailing calldata", `${valid}00` as Hex],
    ["non-CALL packed operation", nonCall],
    [
      "malformed packed call",
      encodeFunctionData({ abi: MULTI_SEND_ABI, functionName: "multiSend", args: ["0x00"] }),
    ],
  ])("keeps %s raw instead of claiming decoded actions", (_, data) => {
    const review = queuedSafeReviewCall(8453, { to: MULTI_SEND_CALL_ONLY, data, operation: 1 });
    expect(review.data).toBe(data);
    expect(review.calls).toBeUndefined();
  });

  it("does not interpret matching calldata sent to an unknown target or via CALL as a Safe batch", () => {
    for (const tx of [
      { to: unknown.to, data: valid, operation: 1 },
      { to: MULTI_SEND_CALL_ONLY, data: valid, operation: 0 },
    ])
      expect(queuedSafeReviewCall(8453, tx).calls).toBeUndefined();
  });
});
