// @vitest-environment node
import {
  JBCoreContracts,
  RevnetCoreContracts,
  jbContractAddress,
  jbMultiTerminalAbi,
  jbPermissionsAbi,
  jbPricesAbi,
} from "@bananapus/nana-sdk-core";
import { buildUserPayMetadata } from "@bananapus/nana-sdk-core/v6";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeContractCall, handleRpc } from "../scripts/browser-fixture-server.mjs";

const participant = getAddress("0x2222222222222222222222222222222222222222");
const otherAccount = getAddress("0x1111111111111111111111111111111111111111");
const usdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const permissions = getAddress(jbContractAddress[6][JBCoreContracts.JBPermissions][8453]);
const revOwner = getAddress(jbContractAddress[6][RevnetCoreContracts.REVOwner][8453]);
const terminal = getAddress(jbContractAddress[6][JBCoreContracts.JBMultiTerminal][8453]);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("browser fixture's unsigned payment draft", () => {
  const metadata = buildUserPayMetadata({ chainId: 1 });
  const args = [1n, usdc, 12_000_000n, zeroAddress, metadata] as const;

  it("previews the $12 USDC draft with the fixture's issuance and reserved share", () => {
    const data = encodeFunctionData({
      abi: jbMultiTerminalAbi,
      functionName: "previewPayFor",
      args,
    });
    const [ruleset, beneficiaryTokenCount, reservedTokenCount, hookSpecifications] =
      decodeFunctionResult({
        abi: jbMultiTerminalAbi,
        functionName: "previewPayFor",
        data: executeContractCall(terminal, data),
      });

    expect(ruleset).toMatchObject({ id: 1, weight: 1_000_000n * 10n ** 18n });
    expect(beneficiaryTokenCount).toBe(9_600_000n * 10n ** 18n);
    expect(reservedTokenCount).toBe(2_400_000n * 10n ** 18n);
    expect(hookSpecifications).toEqual([]);
    expect(() => executeContractCall(otherAccount, data)).toThrow("contract call");
  });

  it.each([
    [2n, usdc, 12_000_000n, zeroAddress, metadata, "projectId"],
    [1n, otherAccount, 12_000_000n, zeroAddress, metadata, "token"],
    [1n, usdc, 0n, zeroAddress, metadata, "amount"],
    [1n, usdc, 12_000_001n, zeroAddress, metadata, "amount"],
    [1n, usdc, 12_000_000n, participant, metadata, "beneficiary"],
    [1n, usdc, 12_000_000n, zeroAddress, "0x", "metadata"],
  ] as const)(
    "rejects an unsupported preview tuple %s/%s/%s/%s/%s",
    (projectId, token, amount, beneficiary, metadata, mismatch) => {
      const data = encodeFunctionData({
        abi: jbMultiTerminalAbi,
        functionName: "previewPayFor",
        args: [projectId, token as Address, amount, beneficiary as Address, metadata as Hex],
      });
      expect(() => executeContractCall(terminal, data)).toThrow(`previewPayFor ${mismatch}`);
    },
  );
});

describe("browser fixture's long viewed identity", () => {
  it("quotes the exact Base USDC currency and rejects the former Ethereum currency", () => {
    const prices = getAddress(jbContractAddress[6][JBCoreContracts.JBPrices][8453]);
    const quote = (currency: bigint) =>
      executeContractCall(
        prices,
        encodeFunctionData({
          abi: jbPricesAbi,
          functionName: "pricePerUnitOf",
          args: [1n, 2n, currency, 18n],
        }),
      );
    expect(
      decodeFunctionResult({
        abi: jbPricesAbi,
        functionName: "pricePerUnitOf",
        data: quote(BigInt(usdc) & 0xffff_ffffn),
      }),
    ).toBe(10n ** 18n);
    expect(() => quote(906_423_112n)).toThrow("pricePerUnitOf quote");
  });

  const nonceProbe = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: otherAccount, data: "0xaffed0e0", gas: "0x186a0" }, "latest"],
  };

  it("returns empty EOA data for the exact bounded queue nonce probe", () => {
    expect(handleRpc(nonceProbe)).toEqual({ jsonrpc: "2.0", id: 1, result: "0x" });
  });

  it.each([
    { to: participant },
    { data: "0xaffed0e000" },
    { gas: "0x186a1" },
    { gas: undefined },
    { from: otherAccount },
  ])("rejects a changed nonce probe: %j", (changed) => {
    expect(() =>
      handleRpc({
        ...nonceProbe,
        params: [{ ...(nonceProbe.params[0] as object), ...changed }, "latest"],
      }),
    ).toThrow("fixture input");
  });

  it("rejects a nonce probe at a different block", () => {
    expect(() => handleRpc({ ...nonceProbe, params: [nonceProbe.params[0], "0x18281d2"] })).toThrow(
      "fixture input",
    );
  });

  it("returns an ABI-encoded zero USDC balance for exactly the participant", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [participant],
    });
    expect(
      decodeFunctionResult({
        abi: erc20Abi,
        functionName: "balanceOf",
        data: executeContractCall(usdc, data),
      }),
    ).toBe(0n);
    expect(() =>
      executeContractCall(
        usdc,
        encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [otherAccount] }),
      ),
    ).toThrow("USDC balanceOf holder");
    expect(() => executeContractCall(otherAccount, data)).toThrow("contract call");
  });

  it.each([0n, 1n])(
    "returns no permission grant for the exact owner and project %s",
    (projectId) => {
      const data = encodeFunctionData({
        abi: jbPermissionsAbi,
        functionName: "permissionsOf",
        args: [participant, revOwner, projectId],
      });
      expect(
        decodeFunctionResult({
          abi: jbPermissionsAbi,
          functionName: "permissionsOf",
          data: executeContractCall(permissions, data),
        }),
      ).toBe(0n);
    },
  );

  it.each([
    [otherAccount, revOwner, 1n, "operator"],
    [participant, otherAccount, 1n, "account"],
    [participant, revOwner, 2n, "projectId"],
  ] as const)(
    "rejects unrelated permission tuples %s/%s/%s",
    (operator, account, projectId, mismatch) => {
      const data = encodeFunctionData({
        abi: jbPermissionsAbi,
        functionName: "permissionsOf",
        args: [operator as Address, account as Address, projectId],
      });
      expect(() => executeContractCall(permissions, data)).toThrow(`permissionsOf ${mismatch}`);
    },
  );
});
