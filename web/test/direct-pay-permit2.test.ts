import {
  addPermit2SignatureToDirectPaySwap,
  buildDirectPaySwapTx,
  NATIVE_SWAP_BY_CHAIN,
  permit2SignatureNeedsOnchainFallback,
  permit2TypedData,
  type DirectSwapQuote,
  type Permit2SignatureAuthorization,
} from "@/lib/directPaySwap";
import { decodeAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const OUTPUT = "0x2222222222222222222222222222222222222222" as Address;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0x4444444444444444444444444444444444444444" as Address;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const SIGNATURE = `0x${"55".repeat(65)}` as Hex;
const MAINNET_CHAIN_IDS = [1, 10, 8453, 42161] as const;

function fixture() {
  const quote: DirectSwapQuote = {
    kind: "direct-swap",
    poolKey: {
      currency0: TOKEN,
      currency1: OUTPUT,
      fee: 10_000,
      tickSpacing: 200,
      hooks: HOOK,
    },
    zeroForOne: true,
    quotedTokenCount: 101n,
    minimumTokenCount: 100n,
    beneficiaryTokenCount: 100n,
    reservedTokenCount: 0n,
    inputRoute: { kind: "single-v4" },
  };
  const request = buildDirectPaySwapTx({
    chainId: 8453,
    quote,
    amount: 25_000_000n,
    recipient: RECIPIENT,
    deadline: 1_800_000_000n,
  });
  const authorization: Permit2SignatureAuthorization = {
    chainId: 8453,
    token: TOKEN,
    spender: request.address,
    amount: 25_000_000n,
    expiration: 1_799_999_900,
    nonce: 7,
    sigDeadline: 1_799_999_900n,
  };
  return { request, authorization };
}

describe("Revnet Permit2 direct-pay signatures", () => {
  it("prepends the reviewed PermitSingle to the exact V4 swap", () => {
    const { request, authorization } = fixture();
    const signed = addPermit2SignatureToDirectPaySwap(request, authorization, SIGNATURE);

    expect(signed.args[0]).toBe("0x0a10");
    expect(signed.args[1]).toHaveLength(2);
    expect(signed.args[1][1]).toBe(request.args[1][0]);
    expect(signed.args[1][0].toLowerCase()).toContain(SIGNATURE.slice(2).toLowerCase());
    expect(signed.args[2]).toBe(request.args[2]);
    expect(permit2TypedData(authorization).message.details.nonce).toBe(7);
  });

  it("fails closed on a mismatched router and never falls back after rejection", () => {
    const { request, authorization } = fixture();
    expect(() =>
      addPermit2SignatureToDirectPaySwap(
        request,
        { ...authorization, spender: zeroAddress },
        SIGNATURE,
      ),
    ).toThrow(/does not match/i);
    expect(
      permit2SignatureNeedsOnchainFallback({ code: 4001, message: "User rejected the request" }),
    ).toBe(false);
    expect(
      permit2SignatureNeedsOnchainFallback({ code: -32602, message: "Invalid parameters" }),
    ).toBe(true);
  });

  it("builds one atomic Base ETH to USDC to project-token swap", () => {
    const quote: DirectSwapQuote = {
      ...fixtureQuote(),
      inputRoute: {
        kind: "native-v3-v4",
        wrappedNative: "0x4200000000000000000000000000000000000006",
        bridgeToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        bridgeTokenSymbol: "USDC",
        bridgeTokenDecimals: 6,
        v3Fee: 500,
        quotedBridgeAmount: 24_900_000n,
      },
    };
    const request = buildDirectPaySwapTx({
      chainId: 8453,
      quote,
      amount: 10_000_000_000_000_000n,
      recipient: RECIPIENT,
      deadline: 1_800_000_000n,
    });

    expect(request.args[0]).toBe("0x0b0010");
    expect(request.args[1]).toHaveLength(3);
    expect(request.value).toBe(10_000_000_000_000_000n);
    const [actions] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      request.args[1][2],
    );
    expect(actions).toBe("0x0b060e");
  });

  it("builds one atomic Base USDC to ETH to project-token swap and prepends Permit2", () => {
    const quote: DirectSwapQuote = {
      ...fixtureQuote(),
      poolKey: {
        currency0: zeroAddress,
        currency1: OUTPUT,
        fee: 10_000,
        tickSpacing: 200,
        hooks: HOOK,
      },
      inputRoute: {
        kind: "erc20-v3-native-v4",
        inputToken: BASE_USDC,
        wrappedNative: "0x4200000000000000000000000000000000000006",
        bridgeTokenSymbol: "ETH",
        bridgeTokenDecimals: 18,
        v3Fee: 500,
        quotedBridgeAmount: 10_000_000_000_000_000n,
      },
    };
    const request = buildDirectPaySwapTx({
      chainId: 8453,
      quote,
      amount: 25_000_000n,
      recipient: RECIPIENT,
      deadline: 1_800_000_000n,
    });

    expect(request.args[0]).toBe("0x000c10");
    expect(request.args[1]).toHaveLength(3);
    expect(request.value).toBe(0n);
    const [actions] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      request.args[1][2],
    );
    expect(actions).toBe("0x0b060e");

    const authorization: Permit2SignatureAuthorization = {
      chainId: 8453,
      token: BASE_USDC,
      spender: request.address,
      amount: 25_000_000n,
      expiration: 1_799_999_900,
      nonce: 7,
      sigDeadline: 1_799_999_900n,
    };
    const signed = addPermit2SignatureToDirectPaySwap(request, authorization, SIGNATURE);
    expect(signed.args[0]).toBe("0x0a000c10");
    expect(signed.args[1]).toHaveLength(4);
    expect(signed.args[1].slice(1)).toEqual(request.args[1]);
  });

  it("builds both bridge directions on every supported mainnet", () => {
    for (const chainId of MAINNET_CHAIN_IDS) {
      const config = NATIVE_SWAP_BY_CHAIN[chainId];
      expect(config, `missing bridge config for chain ${chainId}`).toBeDefined();
      if (!config) continue;

      const nativeRequest = buildDirectPaySwapTx({
        chainId,
        quote: {
          ...fixtureQuote(),
          inputRoute: {
            kind: "native-v3-v4",
            wrappedNative: config.wrappedNative,
            bridgeToken: config.bridgeToken,
            bridgeTokenSymbol: "USDC",
            bridgeTokenDecimals: 6,
            v3Fee: 500,
            quotedBridgeAmount: 25_000_000n,
          },
        },
        amount: 10_000_000_000_000_000n,
        recipient: RECIPIENT,
        deadline: 1_800_000_000n,
      });
      expect(nativeRequest.chainId).toBe(chainId);
      expect(nativeRequest.args[0]).toBe("0x0b0010");

      const erc20Request = buildDirectPaySwapTx({
        chainId,
        quote: {
          ...fixtureQuote(),
          poolKey: {
            currency0: zeroAddress,
            currency1: OUTPUT,
            fee: 10_000,
            tickSpacing: 200,
            hooks: HOOK,
          },
          inputRoute: {
            kind: "erc20-v3-native-v4",
            inputToken: config.bridgeToken,
            wrappedNative: config.wrappedNative,
            bridgeTokenSymbol: "ETH",
            bridgeTokenDecimals: 18,
            v3Fee: 500,
            quotedBridgeAmount: 10_000_000_000_000_000n,
          },
        },
        amount: 25_000_000n,
        recipient: RECIPIENT,
        deadline: 1_800_000_000n,
      });
      expect(erc20Request.chainId).toBe(chainId);
      expect(erc20Request.args[0]).toBe("0x000c10");
    }
  });
});

function fixtureQuote(): DirectSwapQuote {
  return {
    kind: "direct-swap",
    poolKey: {
      currency0: TOKEN,
      currency1: OUTPUT,
      fee: 10_000,
      tickSpacing: 200,
      hooks: HOOK,
    },
    zeroForOne: true,
    quotedTokenCount: 101n,
    minimumTokenCount: 100n,
    beneficiaryTokenCount: 100n,
    reservedTokenCount: 0n,
    inputRoute: { kind: "single-v4" },
  };
}
