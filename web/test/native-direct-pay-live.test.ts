import { readPoolSnapshot } from "@/app/[slug]/components/v6/owners/market/lib";
import { base } from "@/lib/chains";
import { buildDirectPaySwapTx, quoteDirectPaySwap } from "@/lib/directPaySwap";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  type Address,
} from "viem";
import { describe, expect, it } from "vitest";

const rpcUrl = process.env.LIVE_BASE_RPC_URL;

describe.skipIf(!rpcUrl)("live Base native direct-pay route", () => {
  it("quotes and simulates ETH -> USDC -> Artizen in one Universal Router call", async () => {
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const snapshot = await readPoolSnapshot(8453, 6n, client);
    expect(snapshot.hook).not.toBeNull();
    expect(snapshot.pool).not.toBeNull();
    const pool = snapshot.pool!;
    const account = "0x823b92d6a4b2aed4b15675c7917c9f922ea8adad" as Address;
    const amount = 1_000_000_000_000_000n;
    const v3QuoterAbi = [
      {
        type: "function",
        name: "quoteExactInputSingle",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "params",
            type: "tuple",
            components: [
              { name: "tokenIn", type: "address" },
              { name: "tokenOut", type: "address" },
              { name: "amountIn", type: "uint256" },
              { name: "fee", type: "uint24" },
              { name: "sqrtPriceLimitX96", type: "uint160" },
            ],
          },
        ],
        outputs: [
          { name: "amountOut", type: "uint256" },
          { name: "sqrtPriceX96After", type: "uint160" },
          { name: "initializedTicksCrossed", type: "uint32" },
          { name: "gasEstimate", type: "uint256" },
        ],
      },
    ] as const;
    const v3Call = await client.call({
      to: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      data: encodeFunctionData({
        abi: v3QuoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: "0x4200000000000000000000000000000000000006",
            tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amountIn: amount,
            fee: 500,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    });
    expect(v3Call.data).toBeTruthy();
    const [bridgeAmount] = decodeFunctionResult({
      abi: v3QuoterAbi,
      functionName: "quoteExactInputSingle",
      data: v3Call.data!,
    });
    expect(bridgeAmount).toBeGreaterThan(0n);
    const quote = await quoteDirectPaySwap({
      client,
      chainId: 8453,
      poolKey: pool.key,
      pairIsCurrency0: pool.pairIsC0,
      paymentToken: "0x000000000000000000000000000000000000EEEe",
      amount,
      payPreview: { beneficiaryTokenCount: 0n, reservedTokenCount: 0n },
    });
    expect(quote?.inputRoute.kind).toBe("native-v3-v4");
    const request = buildDirectPaySwapTx({
      chainId: 8453,
      quote: quote!,
      amount,
      recipient: account,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_800),
    });
    const result = await client.call({
      account,
      to: request.address,
      value: request.value,
      data: encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      }),
    });
    expect(result.data ?? "0x").toBe("0x");
  }, 30_000);
});
