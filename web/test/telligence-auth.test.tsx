import { useCreatorSession } from "@/hooks/useCreatorSession";
import { useReviewedCreatorSignature } from "@/hooks/useReviewedCreatorSignature";
import { registerTransactionReviewHandler } from "@/lib/transaction-review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type Address } from "viem";
import { createSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "creator-signature-config" },
  account: {
    address: "0x1111111111111111111111111111111111111111" as Address | undefined,
    chainId: 8453 as number | undefined,
  },
  getAccount: vi.fn(),
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
  signMessage: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConfig: () => mocks.config,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getWalletClient: mocks.getWalletClient,
}));
const ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const SIGNATURE = `0x${"11".repeat(65)}`;
const statement = "Sign in to Telligence to manage your compute projects.";
function challenge(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  return {
    challengeId: "challenge-1",
    expiresAt,
    message: createSiweMessage({
      domain: window.location.host,
      address: ADDRESS,
      statement,
      uri: window.location.origin,
      version: "1",
      chainId: 8453,
      nonce: "0123456789abcdef",
      issuedAt: new Date(),
      expirationTime: new Date(expiresAt),
      ...overrides,
    }),
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_TELLIGENCE_GATEWAY_URL;
  window.localStorage.clear();
  mocks.account = { address: ADDRESS, chainId: 8453 };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account = { ...mocks.account, chainId };
  });
  mocks.signMessage.mockResolvedValue(SIGNATURE);
  mocks.getWalletClient.mockResolvedValue({
    account: { address: ADDRESS },
    signMessage: mocks.signMessage,
  });
});

describe("reviewed creator authentication boundary", () => {
  // wallet-action:telligence-creator-signature
  it("reviews the exact Base SIWE authorization before signing", async () => {
    const events: string[] = [];
    const payload = challenge();
    const dispose = registerTransactionReviewHandler(async (review) => {
      events.push("review");
      expect(review).toMatchObject({
        kind: "authorization",
        calls: [],
        authorization: { type: "EIP-4361 Sign-In with Ethereum", message: payload.message },
      });
      return true;
    });
    mocks.signMessage.mockImplementation(async () => {
      events.push("sign");
      return SIGNATURE;
    });
    const { result } = renderHook(useReviewedCreatorSignature);
    await expect(result.current.signCreatorMessageAsync(payload)).resolves.toBe(SIGNATURE);
    expect(events).toEqual(["review", "sign"]);
    expect(mocks.signMessage).toHaveBeenCalledWith({
      account: { address: ADDRESS },
      message: payload.message,
    });
    dispose();
  });

  it.each([
    { domain: "evil.example" },
    { uri: "https://evil.example" },
    { chainId: 1 },
    { address: "0x2222222222222222222222222222222222222222" as Address },
    { statement: "Authorize unlimited transfers" },
    { resources: ["https://evil.example/approval"] },
    { expirationTime: new Date(Date.now() - 1000) },
  ])("refuses a challenge with altered auth scope: %j", async (override) => {
    const { result } = renderHook(useReviewedCreatorSignature);
    await expect(result.current.signCreatorMessageAsync(challenge(override))).rejects.toThrow(
      "sign-in message",
    );
    expect(mocks.signMessage).not.toHaveBeenCalled();
  });

  it("withholds signatures after an account switch while the wallet prompt is open", async () => {
    const dispose = registerTransactionReviewHandler(async () => true);
    mocks.signMessage.mockImplementationOnce(async () => {
      mocks.account = { ...mocks.account, address: "0x2222222222222222222222222222222222222222" };
      return SIGNATURE;
    });
    const { result } = renderHook(useReviewedCreatorSignature);
    await expect(result.current.signCreatorMessageAsync(challenge())).rejects.toThrow(
      "account or network changed",
    );
    dispose();
  });

  it("does not verify a stale signature after the wallet changes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: "Sign in" } }, 401))
      .mockResolvedValueOnce(json(challenge()));
    vi.stubGlobal("fetch", request);
    const dispose = registerTransactionReviewHandler(async () => true);
    mocks.signMessage.mockImplementationOnce(async () => {
      mocks.account = { ...mocks.account, address: "0x2222222222222222222222222222222222222222" };
      return SIGNATURE;
    });
    const { result } = renderHook(useCreatorSession);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.authenticate();
    });
    expect(request.mock.calls.some(([path]) => String(path).endsWith("/v1/auth/verify"))).toBe(
      false,
    );
    expect(result.current.session).toBeNull();
    dispose();
  });

  it("clears the creator session at expiry without waiting for another request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json({
          address: ADDRESS,
          expiresAt: new Date(Date.now() + 1000).toISOString(),
          csrfToken: "csrf",
        }),
      ),
    );
    const { result } = renderHook(useCreatorSession);
    await act(async () => {});
    expect(result.current.session?.address).toBe(ADDRESS);
    await act(async () => {
      vi.advanceTimersByTime(1001);
    });
    expect(result.current.session).toBeNull();
  });

  it("rejects a restored session belonging to another wallet and never persists auth secrets", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json({
          address: "0x2222222222222222222222222222222222222222",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          csrfToken: "csrf",
        }),
      ),
    );
    const { result } = renderHook(useCreatorSession);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(storage).not.toHaveBeenCalled();
  });
});
