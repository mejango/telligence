import { useReviewedPermit2Signature } from "@/hooks/useReviewedPermit2Signature";
import type { Permit2SignatureAuthorization } from "@/lib/directPaySwap";
import { act, renderHook } from "@testing-library/react";
import { type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "permit2-signature-config" },
  account: {
    address: "0x1111111111111111111111111111111111111111" as Address | undefined,
    chainId: 1 as number | undefined,
  },
  getAccount: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const ROUTER = "0x3333333333333333333333333333333333333333" as Address;
const OTHER_ACCOUNT = "0x4444444444444444444444444444444444444444" as Address;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;
const authorization: Permit2SignatureAuthorization = {
  chainId: 8453,
  token: TOKEN,
  spender: ROUTER,
  amount: 25_000_000n,
  expiration: 1_800_000_000,
  nonce: 7,
  sigDeadline: 1_800_000_000n,
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.account = { address: ACCOUNT, chainId: 1 };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account = { ...mocks.account, chainId };
  });
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
});

describe("reviewed Permit2 signature boundary", () => {
  it("reviews and signs the exact short-lived PermitSingle payload", async () => {
    const order: string[] = [];
    const review = await import("@/lib/transaction-review");
    const dispose = review.registerTransactionReviewHandler(async (request) => {
      order.push("review");
      expect(request).toMatchObject({
        kind: "authorization",
        calls: [],
        authorization: {
          domain: {
            name: "Permit2",
            chainId: 8453,
          },
          primaryType: "PermitSingle",
          message: {
            details: { token: TOKEN, amount: 25_000_000n, nonce: 7 },
            spender: ROUTER,
          },
        },
      });
      return true;
    });
    mocks.signTypedData.mockImplementation(async () => {
      order.push("sign");
      return SIGNATURE;
    });

    const { result } = renderHook(() => useReviewedPermit2Signature());
    let signature: Hex | undefined;
    await act(async () => {
      signature = await result.current.signPermit2Async({
        expectedAccount: ACCOUNT,
        authorization,
      });
    });

    expect(signature).toBe(SIGNATURE);
    expect(order).toEqual(["review", "sign"]);
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 8453 });
    expect(mocks.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        primaryType: "PermitSingle",
        message: expect.objectContaining({ spender: ROUTER }),
      }),
    );
    dispose();
  });

  it("fails closed if the connected account changes after signing", async () => {
    mocks.account = { address: ACCOUNT, chainId: 8453 };
    mocks.signTypedData.mockImplementation(async () => {
      mocks.account = { address: OTHER_ACCOUNT, chainId: 8453 };
      return SIGNATURE;
    });
    const { result } = renderHook(() => useReviewedPermit2Signature({ reviewedInParent: true }));

    await expect(
      result.current.signPermit2Async({ expectedAccount: ACCOUNT, authorization }),
    ).rejects.toThrow(/changed after signing/i);
  });
});
