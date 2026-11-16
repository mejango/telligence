import { useSafeTransactionSignature } from "@/hooks/useReviewedAction";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type Address, type Hex, zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerReviews, loadCoreReview, stopAnswering } from "./support/core-review";
import { viemWallet } from "./support/viem-wallet";

const mocks = vi.hoisted(() => ({
  config: { id: "safe-signature-config" },
  account: {
    address: "0x1111111111111111111111111111111111111111" as Address | undefined,
    chainId: 1 as number | undefined,
    connector: { id: "injected", name: "Injected" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getWalletClient: mocks.getWalletClient,
  getPublicClient: () => undefined,
  switchChain: (_config: unknown, request: { chainId: number }) => mocks.switchChain(request),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const SAFE = "0x2222222222222222222222222222222222222222" as Address;
const TARGET = "0x3333333333333333333333333333333333333333" as Address;
const OTHER_ACCOUNT = "0x4444444444444444444444444444444444444444" as Address;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;
const tx = {
  to: TARGET,
  value: "7",
  data: "0x1234" as Hex,
  operation: 0,
  safeTxGas: "100",
  baseGas: "20",
  gasPrice: "1",
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 4,
};

beforeEach(async () => {
  await loadCoreReview();
  stopAnswering();
  window.localStorage.clear();
  clearViewAs();
  mocks.account = {
    address: ACCOUNT,
    chainId: 1,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account = { ...mocks.account, chainId };
  });
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
  mocks.getWalletClient.mockImplementation(async () =>
    viemWallet({ signTypedData: mocks.signTypedData }, () => mocks.account.chainId),
  );
});

describe("reviewed Safe signature boundary", () => {
  it("wallet-action:safe-signature-boundary reviews the exact Safe call before signing its EIP-712 payload", async () => {
    const events: string[] = [];
    let reviewed: unknown;
    const dispose = answerReviews(async (model) => {
      events.push("review");
      const [signature] = model.signatures;
      reviewed = (signature?.typedData as { message?: unknown } | null)?.message;
      expect(signature).toMatchObject({ kind: "safe-tx", chainId: 8453 });
      expect(reviewed).toMatchObject({
        to: TARGET,
        value: 7n,
        data: "0x1234",
        safeTxGas: 100n,
        nonce: 4n,
      });
      return true;
    });
    mocks.signTypedData.mockImplementation(async () => {
      events.push("sign");
      return SIGNATURE;
    });

    const { result } = renderHook(() => useSafeTransactionSignature());
    let signature: Hex | undefined;
    await act(async () => {
      signature = await result.current.signSafeTransactionAsync({
        chainId: 8453,
        safe: SAFE,
        tx,
      });
    });

    expect(signature).toBe(SIGNATURE);
    expect(events).toEqual(["review", "sign"]);
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 8453 });
    expect(mocks.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        domain: { chainId: 8453, verifyingContract: SAFE },
        primaryType: "SafeTx",
        // The wallet signs exactly the message the review showed.
        message: reviewed,
      }),
    );
    dispose();
  });

  it("uses the current wallet after a same-account connector change during review", async () => {
    const currentSign = vi.fn().mockResolvedValue(SIGNATURE);
    const dispose = answerReviews(async () => {
      mocks.account.connector = { id: "walletConnect", name: "WalletConnect" };
      mocks.getWalletClient.mockImplementation(async () =>
        viemWallet({ signTypedData: currentSign }, () => mocks.account.chainId),
      );
      return true;
    });
    const { result } = renderHook(() => useSafeTransactionSignature());
    await act(async () => {
      await expect(
        result.current.signSafeTransactionAsync({ chainId: 1, safe: SAFE, tx }),
      ).resolves.toBe(SIGNATURE);
    });
    expect(currentSign).toHaveBeenCalledOnce();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    dispose();
  });

  it("fails closed if the service hash does not match the reconstructed payload", async () => {
    answerReviews(async () => true);
    const { result } = renderHook(() => useSafeTransactionSignature());

    await expect(
      result.current.signSafeTransactionAsync({
        chainId: 1,
        safe: SAFE,
        tx: { ...tx, safeTxHash: `0x${"ff".repeat(32)}` },
      }),
    ).rejects.toThrow("does not match");
    expect(mocks.switchChain).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  for (const stage of [
    "review",
    "switch",
    "reverify",
    "wallet client",
    "signature",
    "post-sign reverify",
  ] as const) {
    const changes = [
      [
        "account",
        () => {
          mocks.account.address = OTHER_ACCOUNT;
        },
      ],
      [
        "disconnected account",
        () => {
          mocks.account.address = undefined;
        },
      ],
      [
        "chain",
        () => {
          mocks.account.chainId = 10;
        },
      ],
      [
        "Safe wallet mode",
        () => {
          mocks.account.connector!.id = "safe";
        },
      ],
      [
        "view-as mode",
        () => {
          setViewAs(OTHER_ACCOUNT);
        },
      ],
    ] as const;
    // A chain change during review is switched back; a signature already made is bound to its
    // domain's chain, so a later chain change leaves it valid.
    const signed = stage === "signature" || stage === "post-sign reverify";
    it.each(changes.filter(([name]) => (stage !== "review" && !signed) || name !== "chain"))(
      `refuses changed %s after awaiting ${stage}`,
      async (_name, change) => {
        let resume!: () => void;
        let entered = false;
        const pending = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const pause = async () => {
          entered = true;
          await pending;
        };
        const dispose = answerReviews(async () => {
          if (stage === "review") await pause();
          return true;
        });
        mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
          mocks.account.chainId = chainId;
          if (stage === "switch") await pause();
        });
        let checks = 0;
        const reverify = vi.fn(async () => {
          checks += 1;
          if (
            (stage === "reverify" && checks === 1) ||
            (stage === "post-sign reverify" && checks === 2)
          )
            await pause();
        });
        mocks.getWalletClient.mockImplementation(async () => {
          if (stage === "wallet client") await pause();
          return viemWallet({ signTypedData: mocks.signTypedData }, () => mocks.account.chainId);
        });
        mocks.signTypedData.mockImplementation(async () => {
          if (stage === "signature") await pause();
          return SIGNATURE;
        });
        const { result } = renderHook(() => useSafeTransactionSignature());
        const signing = result.current.signSafeTransactionAsync({
          chainId: 8453,
          safe: SAFE,
          tx,
          reverify,
        });
        const refused = expect(signing).rejects.toThrow(/changed|Exit View as/i);

        await waitFor(() => expect(entered).toBe(true));
        change();
        resume();
        await refused;

        expect(mocks.signTypedData).toHaveBeenCalledTimes(signed ? 1 : 0);
        if (stage === "review") expect(mocks.switchChain).not.toHaveBeenCalled();
        dispose();
      },
    );
  }

  it("reverifies Safe authority before and after the wallet signs", async () => {
    const events: string[] = [];
    const dispose = answerReviews(async () => {
      events.push("review");
      return true;
    });
    mocks.signTypedData.mockImplementation(async () => {
      events.push("sign");
      return SIGNATURE;
    });
    const reverify = vi.fn(async () => {
      events.push("reverify");
    });
    const { result } = renderHook(() => useSafeTransactionSignature());

    await act(async () => {
      await result.current.signSafeTransactionAsync({
        chainId: 1,
        safe: SAFE,
        tx,
        reverify,
      });
    });

    expect(reverify).toHaveBeenCalledTimes(2);
    expect(reverify).toHaveBeenNthCalledWith(1, ACCOUNT);
    expect(reverify).toHaveBeenNthCalledWith(2, ACCOUNT);
    expect(events).toEqual(["review", "reverify", "sign", "reverify"]);
    dispose();
  });

  it("withholds a wallet-produced signature when Safe authority rotates during the prompt", async () => {
    const dispose = answerReviews(async () => true);
    const reverify = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The Safe policy changed during signing."));
    const { result } = renderHook(() => useSafeTransactionSignature());

    await expect(
      result.current.signSafeTransactionAsync({
        chainId: 1,
        safe: SAFE,
        tx,
        reverify,
      }),
    ).rejects.toThrow("policy changed");
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(reverify).toHaveBeenCalledTimes(2);
    dispose();
  });
});
