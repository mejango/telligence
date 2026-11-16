import { reviewedCall } from "@/lib/reviewed-call";
import { describe, expect, it } from "vitest";
import { baselineRequests } from "./fixtures/reviewed-call-requests";
import baseline from "./fixtures/reviewed-write-calldata.json";

// The baseline is what the old engine (useReviewedWriteContract) sent and held each write by,
// captured before it was deleted.
describe("reviewedCall", () => {
  it("sends the same calldata as the old engine for an approval, a payment, a cash out and a loan", () => {
    for (const { name, request, intent, legacy } of baselineRequests()) {
      const expected = baseline.find((row) => row.name === name)!;
      const call = reviewedCall(request, { intent, legacyIntents: legacy });
      expect({
        chainId: call.chainId,
        to: call.to,
        value: String(call.value),
        data: call.data,
      }).toEqual({
        chainId: expected.chainId,
        to: expected.to,
        value: expected.value,
        data: expected.data,
      });
    }
  });

  it("keeps the intent and legacy hold namespaces", () => {
    for (const { name, request, intent, legacy } of baselineRequests()) {
      const expected = baseline.find((row) => row.name === name)!;
      const call = reviewedCall(request, { intent, legacyIntents: legacy });
      expect(call.intent ?? null).toBe(expected.namespace);
      expect((call.legacy ?? []).filter((key) => typeof key === "string")).toEqual(
        expected.legacyNamespaces,
      );
    }
  });
});
