import { minReturnedTokens } from "@/lib/quote";
import {
  formatPayAmount,
  formatStartCountdown,
  isNativePayToken,
  payTokenCurrencyId,
  payTokenKey,
  routerPayRouteWorks,
  tierDisplayMetadata,
  tierMediaAssetUrl,
  tierMediaImageUrl,
} from "@/lib/v6/pay";
import {
  getJBContractAddress,
  jbContractAddress,
  JBRouterTerminalContracts,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import type { PayPreview } from "@bananapus/nana-sdk-core/v6";
import type { Address, PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ACCOUNT } from "./fixtures/revnet";

const { previewPayMock } = vi.hoisted(() => ({ previewPayMock: vi.fn() }));

vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  previewPay: previewPayMock,
}));

import { resolveBestV6PayRoute } from "@/lib/paymentTerminal";

const TOKEN = USDC_ADDRESSES[sepolia.id];
const ROUTER = getJBContractAddress(
  JBRouterTerminalContracts.JBRouterTerminalRegistry,
  6,
  sepolia.id,
);
const MULTI = jbContractAddress[6].JBMultiTerminal[sepolia.id] as Address;

const routeArgs = {
  client: {} as PublicClient,
  chainId: sepolia.id,
  projectId: 7n,
  token: TOKEN,
  amount: 1_000_000n,
  beneficiary: TEST_ACCOUNT,
};

function preview(beneficiaryTokenCount: bigint, reservedTokenCount = 0n): PayPreview {
  return { beneficiaryTokenCount, reservedTokenCount };
}

beforeEach(() => {
  previewPayMock.mockReset();
});

describe("wallet-action:pay — v6 payment route selection", () => {
  it("selects the live route which returns the beneficiary the most tokens", async () => {
    previewPayMock.mockImplementation(async (_client: PublicClient, args: { terminal: Address }) =>
      args.terminal.toLowerCase() === ROUTER.toLowerCase() ? preview(100n) : preview(120n),
    );

    const result = await resolveBestV6PayRoute(routeArgs);

    expect(result).toMatchObject({ address: MULTI, type: "multi", preview: preview(120n) });
    expect(previewPayMock).toHaveBeenCalledTimes(2);
    expect(previewPayMock).toHaveBeenCalledWith(
      routeArgs.client,
      expect.objectContaining({
        chainId: sepolia.id,
        projectId: 7n,
        token: TOKEN,
        amount: 1_000_000n,
        beneficiary: TEST_ACCOUNT,
        metadata: "0x",
      }),
    );
  });

  it("uses reserved issuance as the second tie-breaker, then prefers the direct terminal", async () => {
    previewPayMock.mockImplementation(async (_client: PublicClient, args: { terminal: Address }) =>
      args.terminal.toLowerCase() === ROUTER.toLowerCase()
        ? preview(100n, 10n)
        : preview(100n, 20n),
    );
    expect((await resolveBestV6PayRoute(routeArgs))?.address).toBe(MULTI);

    previewPayMock.mockResolvedValue(preview(100n, 20n));
    expect((await resolveBestV6PayRoute(routeArgs))?.address).toBe(MULTI);
  });

  it("skips a reverting candidate and fails closed when no route can be previewed", async () => {
    previewPayMock.mockImplementation(
      async (_client: PublicClient, args: { terminal: Address }) => {
        if (args.terminal.toLowerCase() === ROUTER.toLowerCase()) throw new Error("dead pool");
        return preview(50n);
      },
    );
    expect(await resolveBestV6PayRoute(routeArgs)).toMatchObject({ address: MULTI, type: "multi" });

    previewPayMock.mockRejectedValue(new Error("no accounting context"));
    expect(await resolveBestV6PayRoute(routeArgs)).toBeNull();
  });
});

describe("router and minimum-output guardrails", () => {
  it("does not conflate a direct custom-token route with a router route", () => {
    const customToken = "0x000000000000000000000000000000000000cafe" as Address;
    expect(payTokenKey({ token: customToken, viaRouter: false })).not.toBe(
      payTokenKey({ token: customToken, viaRouter: true }),
    );
    expect(payTokenCurrencyId(customToken)).toBeGreaterThanOrEqual(0);
    expect(isNativePayToken(customToken)).toBe(false);
    expect(isNativePayToken(NATIVE_TOKEN.toLowerCase())).toBe(true);
  });

  it("accepts only a preview with a live ruleset and caches the exact route probe", async () => {
    const readContract = vi.fn().mockResolvedValue([{ id: 9n }]);
    const client = { readContract } as unknown as PublicClient;
    const projectId = 9001n;

    await expect(
      routerPayRouteWorks(client, sepolia.id, projectId, ROUTER, TOKEN, 6),
    ).resolves.toBe(true);
    await expect(
      routerPayRouteWorks(client, sepolia.id, projectId, ROUTER, TOKEN, 6),
    ).resolves.toBe(true);
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ROUTER,
        functionName: "previewPayFor",
        args: [projectId, TOKEN, 1_000_000n, "0x0000000000000000000000000000000000000001", "0x"],
      }),
    );
  });

  it("fails closed for a dead or unavailable custom-token router path", async () => {
    const deadClient = {
      readContract: vi.fn().mockResolvedValue([{ id: 0n }]),
    } as unknown as PublicClient;
    const unavailableClient = {
      readContract: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    } as unknown as PublicClient;

    await expect(
      routerPayRouteWorks(deadClient, sepolia.id, 9002n, ROUTER, TOKEN, 6),
    ).resolves.toBe(false);
    await expect(
      routerPayRouteWorks(unavailableClient, sepolia.id, 9003n, ROUTER, TOKEN, 6),
    ).resolves.toBe(false);
  });

  it("keeps verified zero issuance at zero and never erases protection for a positive quote", () => {
    expect(minReturnedTokens(0n)).toBe(0n);
    expect(minReturnedTokens(-1n)).toBe(0n);
    expect(minReturnedTokens(10_000n, 500n)).toBe(9_500n);
    expect(minReturnedTokens(1n, 500n)).toBe(1n);
  });
});

describe("pay display normalization", () => {
  const CID = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";

  it("formats countdown boundaries without showing zero-minute starts", () => {
    expect(formatStartCountdown(-1)).toBe("moments");
    expect(formatStartCountdown(59)).toBe("1m");
    expect(formatStartCountdown(3_660)).toBe("1h 1m");
    expect(formatStartCountdown(90_000)).toBe("1d 1h");
  });

  it("formats token base units with bounded, locale-stable precision", () => {
    expect(formatPayAmount(1_234_567n, 6)).toBe("1.2346");
    expect(formatPayAmount(1n, 6)).toBe("0.000001");
    expect(formatPayAmount(1_234_567_890_000_000_000_000n, 18)).toBe("1,234.5679");
  });

  it("routes immutable tier media through the app gateway and unwraps SVG image shells", () => {
    expect(tierMediaAssetUrl(`ipfs://${CID}/animation.mp4`)).toBe(
      `https://juicebox.center/ipfs/${CID}/animation.mp4`,
    );
    expect(
      tierDisplayMetadata({
        name: "Poster",
        image: `ipfs://${CID}/image.png`,
        animation_url: `${CID}/animation.mp4`,
      }),
    ).toMatchObject({
      name: "Poster",
      image: `https://juicebox.center/ipfs/${CID}/image.png`,
      animationUrl: `https://juicebox.center/ipfs/${CID}/animation.mp4`,
    });

    const svg = `<svg><image href="ipfs://${CID}/wrapped.png" /></svg>`;
    expect(tierMediaImageUrl(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toBe(
      `https://juicebox.center/ipfs/${CID}/wrapped.png`,
    );
  });
});
