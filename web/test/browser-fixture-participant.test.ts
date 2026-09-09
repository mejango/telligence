// @vitest-environment node
import {
  JBCoreContracts,
  RevnetCoreContracts,
  jbContractAddress,
  jbPermissionsAbi,
  jbPricesAbi,
} from "@bananapus/nana-sdk-core";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeContractCall } from "../scripts/browser-fixture-server.mjs";

const participant = getAddress("0x2222222222222222222222222222222222222222");
const otherAccount = getAddress("0x1111111111111111111111111111111111111111");
const usdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const permissions = getAddress(jbContractAddress[6][JBCoreContracts.JBPermissions][8453]);
const revOwner = getAddress(jbContractAddress[6][RevnetCoreContracts.REVOwner][8453]);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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
