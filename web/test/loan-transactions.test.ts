import {
  buildProtectedBorrowTx,
  buildProtectedReallocateCollateralTx,
  minimumBorrowAmount,
  readFreshBorrowableAmount,
} from "@/lib/loanTransactions";
import { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const TOKEN = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";

describe("wallet-action:loans — protected loan transactions", () => {
  it("floor-rounds the fresh contract quote to 99% and refuses zero", () => {
    expect(minimumBorrowAmount(1_001n)).toBe(990n);
    expect(() => minimumBorrowAmount(0n)).toThrow(/no backing/u);
    expect(() => minimumBorrowAmount(1n)).toThrow(/rounds to zero/u);
  });

  it("encodes a nonzero fresh floor in standard borrows", () => {
    const request = buildProtectedBorrowTx({
      chainId: 1,
      revnetId: 7n,
      token: TOKEN,
      quotedBorrowAmount: 1_000_000n,
      collateralCount: 2n * 10n ** 18n,
      beneficiary: ACCOUNT,
      prepaidFeePercent: 25n,
      holder: ACCOUNT,
    });

    expect(request.functionName).toBe("borrowFrom");
    expect(request.args[2]).toBe(990_000n);
    expect(request.args[3]).toBe(2n * 10n ** 18n);
  });

  it("encodes a nonzero fresh floor in reallocation borrows", () => {
    const request = buildProtectedReallocateCollateralTx({
      chainId: 1,
      loanId: 9n,
      collateralCountToTransfer: 3n * 10n ** 18n,
      token: TOKEN,
      quotedBorrowAmount: 2_000_000n,
      collateralCountToAdd: 1n * 10n ** 18n,
      beneficiary: ACCOUNT,
      prepaidFeePercent: 25n,
    });

    expect(request.functionName).toBe("reallocateCollateralFromLoan");
    expect(request.args[1]).toBe(3n * 10n ** 18n);
    expect(request.args[3]).toBe(1_980_000n);
    expect(request.args[4]).toBe(1n * 10n ** 18n);
  });

  it("reads the selected source token's exact decimals and currency at submit time", async () => {
    const readContract = vi.fn().mockResolvedValue([123_456n, 999_999n]);
    const quote = await readFreshBorrowableAmount({ readContract } as unknown as PublicClient, {
      chainId: 10,
      revnetId: 7n,
      collateralCount: 2n * 10n ** 18n,
      decimals: 6n,
      currency: 8453n,
    });

    expect(quote).toBe(123_456n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "borrowableAmountFrom",
        args: [7n, 2n * 10n ** 18n, 6n, 8453n],
      }),
    );

    readContract.mockResolvedValueOnce([0n, 999_999n]);
    await expect(
      readFreshBorrowableAmount({ readContract } as unknown as PublicClient, {
        chainId: 10,
        revnetId: 7n,
        collateralCount: 1n,
        decimals: 6n,
        currency: 8453n,
      }),
    ).rejects.toThrow(/Nothing is currently borrowable/u);
  });
});
