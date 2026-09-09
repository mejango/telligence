import {
  buildProtectedBridgePrepareTx,
  cashOutProtocolFee,
  protectedOutputFloor,
  quoteBridgePrepare,
  slippagePercentToBps,
} from "@/lib/bridgePrepare";
import { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const SUCKER = "0x1111111111111111111111111111111111111111";
const BENEFICIARY = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";

describe("wallet-action:bridge-prepare — protected bridge preparation", () => {
  it("mirrors the contract's standard fee branches and rounding", () => {
    expect(
      cashOutProtocolFee({
        reclaimAmount: 1_001n,
        cashOutTaxRate: 1n,
        beneficiaryIsFeeless: false,
        feeFreeSurplus: 0n,
      }),
    ).toBe(25n);
    expect(
      cashOutProtocolFee({
        reclaimAmount: 1_001n,
        cashOutTaxRate: 0n,
        beneficiaryIsFeeless: false,
        feeFreeSurplus: 400n,
      }),
    ).toBe(10n);
    expect(
      cashOutProtocolFee({
        reclaimAmount: 1_001n,
        cashOutTaxRate: 1n,
        beneficiaryIsFeeless: true,
        feeFreeSurplus: 1_001n,
      }),
    ).toBe(0n);
  });

  it("uses a user-selected, floor-rounded tolerance", () => {
    expect(slippagePercentToBps("1")).toBe(100n);
    expect(slippagePercentToBps("0.25")).toBe(25n);
    expect(protectedOutputFloor(1_001n, 100n)).toBe(990n);
    expect(() => slippagePercentToBps("1.234")).toThrow(/at most two decimal places/u);
    expect(() => slippagePercentToBps("5.01")).toThrow(/cannot exceed 5%/u);
    expect(() => protectedOutputFloor(0n, 100n)).toThrow(/no backing/u);
    expect(() => protectedOutputFloor(1_000n, 10_000n)).toThrow(/less than 100%/u);
    expect(() => protectedOutputFloor(1n, 100n)).toThrow(/rounds to zero/u);
  });

  it("encodes the reviewed nonzero minimum in prepare", () => {
    const request = buildProtectedBridgePrepareTx({
      chainId: 1,
      sucker: SUCKER,
      projectTokenCount: 10n ** 18n,
      beneficiary: BENEFICIARY,
      minTokensReclaimed: 975_000n,
      token: TOKEN,
    });

    expect(request.functionName).toBe("prepare");
    expect(request.args[0]).toBe(10n ** 18n);
    expect(request.args[2]).toBe(975_000n);
    expect(() =>
      buildProtectedBridgePrepareTx({
        chainId: 1,
        sucker: SUCKER,
        projectTokenCount: 0n,
        beneficiary: BENEFICIARY,
        minTokensReclaimed: 975_000n,
        token: TOKEN,
      }),
    ).toThrow(/include project tokens/u);
    expect(() =>
      buildProtectedBridgePrepareTx({
        chainId: 1,
        sucker: SUCKER,
        projectTokenCount: 10n ** 18n,
        beneficiary: BENEFICIARY,
        minTokensReclaimed: 0n,
        token: TOKEN,
      }),
    ).toThrow(/nonzero/u);
  });

  it("quotes with the same sucker caller context and current three-argument feeless lookup", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      switch (request.functionName) {
        case "previewCashOutFrom":
          return [{}, 1_000n, 1n, []];
        case "feeFreeSurplusOf":
          return 0n;
        case "FEELESS_ADDRESSES":
          return "0x4444444444444444444444444444444444444444";
        case "accountingContextForTokenOf":
          return { token: TOKEN, decimals: 6, currency: 1 };
        case "isFeelessFor":
          return false;
        default:
          throw new Error(`Unexpected read: ${request.functionName}`);
      }
    });

    const quote = await quoteBridgePrepare({ readContract } as unknown as PublicClient, {
      chainId: 1,
      projectId: 7n,
      sucker: SUCKER,
      projectTokenCount: 10n ** 18n,
      terminalToken: TOKEN,
      slippageBps: 100n,
    });

    expect(quote).toEqual({
      grossReclaimAmount: 1_000n,
      netReclaimAmount: 975n,
      minTokensReclaimed: 965n,
      tokenDecimals: 6,
    });
    const previewRead = readContract.mock.calls.find(
      ([request]) => request.functionName === "previewCashOutFrom",
    )?.[0] as { account?: string; args?: readonly unknown[] };
    expect(previewRead.account).toBe(SUCKER);
    expect(previewRead.args?.[0]).toBe(SUCKER);
    expect(previewRead.args?.[4]).toBe(SUCKER);
    const feelessRead = readContract.mock.calls.find(
      ([request]) => request.functionName === "isFeelessFor",
    )?.[0] as { args?: readonly unknown[] };
    expect(feelessRead.args).toEqual([SUCKER, 7n, SUCKER]);
  });
});
