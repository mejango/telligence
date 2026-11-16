import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { relative, resolve } from "node:path";
import ts from "typescript";
import {
  createPublicClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
} from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { lineOf, parseSource, sourceFiles } from "./support/source-scan";

// USDT on Ethereum returns nothing from approve(). viem's erc20Abi declares a
// bool output, so simulating such an approval failed to decode ("returned no
// data") and a USDT revnet could not pay, repay or add liquidity.

const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;
const OWNER = "0x000000000000000000000000000000000000dEaD" as Address;
const SPENDER = "0x000000000000000000000000000000000000bEEF" as Address;
const SRC = resolve(process.cwd(), "src");

/** `x as const`, `x satisfies T` and `(x)` are `x`. */
function bare(node: ts.Expression): ts.Expression {
  return ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
    ? bare(node.expression)
    : node;
}

/** Every `{ abi: erc20Abi, functionName: "approve" }` in a file, as `path:line`. */
function erc20AbiApprovals(path: string): string[] {
  const source = parseSource(path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const value = (name: string) =>
        node.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === name,
        )?.initializer;
      const abi = value("abi");
      const functionName = value("functionName");
      if (
        abi &&
        functionName &&
        ts.isIdentifier(bare(abi)) &&
        (bare(abi) as ts.Identifier).text === "erc20Abi" &&
        ts.isStringLiteralLike(bare(functionName)) &&
        (bare(functionName) as ts.StringLiteralLike).text === "approve"
      ) {
        found.push(`${relative(SRC, path)}:${lineOf(node, source)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("ERC-20 approvals of tokens whose approve returns nothing", () => {
  it("is erc20Abi's approve without the bool output, with the same calldata", () => {
    expect(erc20ApproveAbi).toEqual(
      parseAbi(["function approve(address spender, uint256 amount)"]),
    );
    expect(
      encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [SPENDER, 5n] }),
    ).toBe(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, 5n] }));
  });

  it("simulates an approve that returns no data, where erc20Abi's declared bool fails", async () => {
    // A successful approve() whose call returns nothing, as USDT's does.
    const client = createPublicClient({
      chain: mainnet,
      transport: custom({
        request: async ({ method }: { method: string }) => {
          if (method === "eth_call") return "0x";
          throw new Error(`Unexpected ${method}`);
        },
      }),
    });
    const approval = {
      address: USDT,
      functionName: "approve" as const,
      args: [SPENDER, 5n] as const,
      account: OWNER,
    };

    await expect(
      client.simulateContract({ ...approval, abi: erc20ApproveAbi }),
    ).resolves.toMatchObject({ request: { functionName: "approve" } });
    await expect(client.simulateContract({ ...approval, abi: erc20Abi })).rejects.toThrow(
      /returned no data/,
    );
  });

  // It parses every file in src: seconds alone, and past the default timeout beside a full parallel suite.
  it("is the ABI every approve in the app is sent and reviewed with", () => {
    expect(sourceFiles(SRC).flatMap(erc20AbiApprovals)).toEqual([]);
  }, 60_000);
});
