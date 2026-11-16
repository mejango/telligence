import {
  PAY_FLOW_START,
  payFlow,
  payFlowView,
  type PayFlow,
  type PayFlowAction,
} from "@/app/[slug]/components/v6/pay/payFlow";
import type { PreparedV6Pay } from "@/app/[slug]/components/v6/pay/V6PayConfirmDialog";
import { describe, expect, it } from "vitest";

const PREPARED = { identity: "a", tokenApprovalComplete: false } as PreparedV6Pay;
const HASH = `0x${"ab".repeat(32)}` as const;
const run = (...actions: PayFlowAction[]) =>
  actions.reduce<PayFlow>((flow, action) => payFlow(flow, action), PAY_FLOW_START);

describe("the pay card's confirm flow", () => {
  it("carries a rebuild's notice into the ready payment, and drops it once sent", () => {
    const ready = run(
      { type: "open" },
      { type: "prepare", notice: "The payment changed." },
      { type: "prepared", prepared: PREPARED },
    );
    expect(payFlowView(ready)).toMatchObject({ phase: "ready", error: "The payment changed." });
    const sent = run(
      { type: "open" },
      { type: "prepared", prepared: PREPARED },
      { type: "send", phase: "approving-token" },
      { type: "approved" },
      { type: "send", phase: "signing" },
      { type: "submitted", hash: HASH },
      { type: "done" },
    );
    expect(payFlowView(sent)).toMatchObject({ phase: "success", error: null, txHash: HASH });
    expect(payFlowView(sent).prepared?.tokenApprovalComplete).toBe(true);
  });

  it("offers one recovery at a time, and closing the confirm abandons it", () => {
    const failed = run(
      { type: "open" },
      { type: "prepared", prepared: PREPARED },
      { type: "send", phase: "simulating" },
      { type: "failed", error: "Short.", recovery: { kind: "slippage", bps: 350 } },
      { type: "slippage", bps: 400 },
    );
    expect(payFlowView(failed)).toMatchObject({
      retrySlippageBps: 400,
      revertedOnchain: false,
      error: "Short.",
    });
    const closed = payFlow(failed, { type: "show", open: false });
    expect(payFlowView(closed)).toMatchObject({ retrySlippageBps: null, error: "Short." });
    expect(closed.open).toBe(false);
  });

  it("keeps a Safe proposal followed while the confirm is closed, and names an approval", () => {
    const proposed = run(
      { type: "open" },
      { type: "prepared", prepared: PREPARED },
      { type: "send", phase: "approving-token" },
      { type: "proposed", hash: HASH, approval: true },
      { type: "show", open: false },
    );
    expect(proposed).toMatchObject({ phase: "safe-proposed", approval: true, open: false });
  });

  it("ignores a preparation that lands after the flow moved on", () => {
    const flow = run({ type: "open" }, { type: "failed", error: "No quote." });
    expect(payFlow(flow, { type: "prepared", prepared: PREPARED })).toBe(flow);
  });
});
