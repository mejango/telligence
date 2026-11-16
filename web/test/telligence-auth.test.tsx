import { useCreatorSession } from "@/hooks/useCreatorSession";
import { useReviewedCreatorSignature } from "@/hooks/useReviewedCreatorSignature";
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
  signReviewed: vi.fn(),
  signMessage: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConfig: () => mocks.config,
}));
vi.mock("wagmi/actions", () => ({ getAccount: mocks.getAccount }));
// Core's reviewed signature, reduced to its contract with sign-in: the review of the exact
// message, the recheck, the wallet, then the adapter's check that the wallet did not change.
vi.mock("@/hooks/useReviewedAction", () => ({
  loadEngine: async () => ({ signReviewed: mocks.signReviewed }),
  reviewedWalletAdapter: (_config: unknown, account: Address) => ({
    requireUnchanged: () => {
      if (mocks.account.address !== account)
        throw new Error("The connected account changed. Review again.");
    },
  }),
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
  mocks.signMessage.mockReset();
  mocks.signMessage.mockResolvedValue(SIGNATURE);
  mocks.signReviewed.mockReset();
  mocks.signReviewed.mockImplementation(
    async (signatures: { message: string }[], action: { reverify?: () => Promise<void> }) => {
      await action.reverify?.();
      return [await mocks.signMessage(signatures[0]!.message)];
    },
  );
});

describe("reviewed creator authentication boundary", () => {
  // wallet-action:telligence-creator-signature
  it("reviews the exact Base SIWE authorization before signing", async () => {
    const payload = challenge();
    const { result } = renderHook(useReviewedCreatorSignature);
    await expect(result.current.signCreatorMessageAsync(payload)).resolves.toBe(SIGNATURE);
    expect(mocks.signReviewed).toHaveBeenCalledTimes(1);
    const [signatures, action] = mocks.signReviewed.mock.calls[0]!;
    expect(signatures).toEqual([{ kind: "message", chainId: 8453, message: payload.message }]);
    expect(action).toMatchObject({ account: ADDRESS, title: "Sign in to Telligence" });
    expect(mocks.signMessage).toHaveBeenCalledWith(payload.message);
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
    expect(mocks.signReviewed).not.toHaveBeenCalled();
  });

  it("withholds signatures after an account switch while the wallet prompt is open", async () => {
    mocks.signMessage.mockImplementationOnce(async () => {
      mocks.account = { ...mocks.account, address: "0x2222222222222222222222222222222222222222" };
      return SIGNATURE;
    });
    const { result } = renderHook(useReviewedCreatorSignature);
    await expect(result.current.signCreatorMessageAsync(challenge())).rejects.toThrow(
      "account changed",
    );
  });

  it("does not verify a stale signature after the wallet changes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: "Sign in" } }, 401))
      .mockResolvedValueOnce(json(challenge()));
    vi.stubGlobal("fetch", request);
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
