import { base } from "@/lib/chains";
import {
  VVV_ADDRESS,
  assertDeploymentConfig,
  assertLaunchDeploymentConfig,
  buildComputePayment,
  parseVvvAmount,
} from "@/lib/telligence/transactions";
import { SUPPORTED_CHAINS, getViemPublicClient } from "@/lib/wagmiTransports";
import { describe, expect, it } from "vitest";

const terminal = "0x1234567890123456789012345678901234567890" as const;
const payer = "0x2222222222222222222222222222222222222222" as const;

describe("Telligence transaction boundary", () => {
  it("configures Base only and refuses a transport for another chain", () => {
    expect(SUPPORTED_CHAINS.map((chain) => chain.id)).toEqual([base.id]);
    expect(() => getViemPublicClient(1)).toThrow(/Base/);
  });

  it("accepts exact positive VVV amounts without rounding or scientific notation", () => {
    expect(parseVvvAmount("1.000000000000000001")).toBe(1000000000000000001n);
    for (const value of ["0", "-1", "1e3", "Infinity", "0.0000000000000000001", " 1", "1."]) {
      expect(() => parseVvvAmount(value)).toThrow();
    }
  });

  it("rejects inactive or substituted deployment identities before a wallet prompt", () => {
    const config = {
      ready: true,
      policyVersion: "2" as const,
      chainId: 8453,
      factoryAddress: payer,
      canonicalTerminal: terminal,
      vvvAddress: VVV_ADDRESS,
    };
    expect(() => assertDeploymentConfig(config)).not.toThrow();
    expect(() => assertDeploymentConfig({ ...config, ready: false })).toThrow(/available/);
    expect(() => assertDeploymentConfig({ ...config, chainId: 1 })).toThrow(/Base/);
    expect(() => assertDeploymentConfig({ ...config, vvvAddress: payer })).toThrow(/VVV/);
    expect(() =>
      assertDeploymentConfig({
        ...config,
        factoryAddress: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(/deployment/);
  });

  it("supports existing deployments but requires version 2 for new launches", () => {
    const config = {
      ready: true,
      policyVersion: "2",
      chainId: 8453,
      factoryAddress: payer,
      canonicalTerminal: terminal,
      vvvAddress: VVV_ADDRESS,
    };
    expect(() => assertDeploymentConfig({ ...config, policyVersion: "1" })).not.toThrow();
    expect(() => assertLaunchDeploymentConfig(config)).not.toThrow();
    expect(() => assertLaunchDeploymentConfig({ ...config, policyVersion: "1" })).toThrow(
      /version/i,
    );
    for (const policyVersion of [undefined, null, "", "0", "3", 1, 2]) {
      expect(() => assertDeploymentConfig({ ...config, policyVersion })).toThrow(/version/i);
      expect(() => assertLaunchDeploymentConfig({ ...config, policyVersion })).toThrow(/version/i);
    }
  });

  it("preserves stock buybacks and production splits with exact VVV inputs", () => {
    const payment = buildComputePayment({
      projectId: 42n,
      terminal,
      beneficiary: payer,
      amount: 25n * 10n ** 18n,
      quotedTokens: 30n * 10n ** 18n,
      slippageBps: 100,
    });
    expect(payment.chainId).toBe(8453);
    expect(payment.address).toBe(terminal);
    expect(payment.functionName).toBe("pay");
    expect(payment.args).toEqual([
      42n,
      VVV_ADDRESS,
      25n * 10n ** 18n,
      payer,
      297n * 10n ** 17n,
      "Support compute",
      "0x",
    ]);
    expect(payment.value).toBe(0n);
  });

  it("refuses a zero output quote or excessive slippage", () => {
    const args = {
      projectId: 42n,
      terminal,
      beneficiary: payer,
      amount: 1n,
      quotedTokens: 10n ** 18n,
      slippageBps: 100,
    };
    expect(() => buildComputePayment({ ...args, quotedTokens: 0n })).toThrow(/quote/);
    expect(() => buildComputePayment({ ...args, slippageBps: 5001 })).toThrow(/slippage/);
  });
});
