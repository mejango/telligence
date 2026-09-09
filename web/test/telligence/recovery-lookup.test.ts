import {
  configuredRecoveryFactory,
  lookupRecoveryProject,
  parseRecoveryProjectId,
} from "@/lib/telligence/recovery-lookup";
import { describe, expect, it, vi } from "vitest";

const factory = "0x1111111111111111111111111111111111111111";
const policy = "0x2222222222222222222222222222222222222222";
const vault = "0x3333333333333333333333333333333333333333";
const creator = "0x4444444444444444444444444444444444444444";
const client = () => ({
  getChainId: vi.fn().mockResolvedValue(8453),
  getCode: vi.fn().mockResolvedValue("0x60006000"),
  readContract: vi
    .fn()
    .mockImplementation(({ functionName }) =>
      Promise.resolve(
        { policyOf: policy, vaultOf: vault, creatorOf: creator }[functionName as "policyOf"],
      ),
    ),
});

describe("gateway-independent recovery lookup", () => {
  it("parses a positive uint256 project id without rounded number conversion", () => {
    expect(parseRecoveryProjectId("9007199254740993")).toBe(9007199254740993n);
    for (const value of ["0", "01", "1e3", "-1", String(2n ** 256n)])
      expect(() => parseRecoveryProjectId(value)).toThrow();
  });
  it("requires an explicit nonzero trusted build-time factory", () => {
    expect(configuredRecoveryFactory(factory)).toBe(factory);
    expect(() => configuredRecoveryFactory("")).toThrow();
    expect(() => configuredRecoveryFactory("0x0000000000000000000000000000000000000000")).toThrow();
  });
  it("reads the policy and vault from the pinned Base factory without a gateway", async () => {
    const rpc = client();
    expect(await lookupRecoveryProject(rpc, factory, 12n)).toEqual({
      revnetId: 12n,
      factoryAddress: factory,
      policyAddress: policy,
      vaultAddress: vault,
      creatorAddress: creator,
    });
    expect(rpc.getChainId).toHaveBeenCalledOnce();
    expect(rpc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: factory, functionName: "policyOf", args: [12n] }),
    );
    expect(rpc.getCode).toHaveBeenCalledTimes(3);
  });
  it("rejects another chain, an empty factory or an unregistered project", async () => {
    const otherChain = client();
    otherChain.getChainId.mockResolvedValue(1);
    await expect(lookupRecoveryProject(otherChain, factory, 12n)).rejects.toThrow(/Base/);
    expect(otherChain.readContract).not.toHaveBeenCalled();
    const emptyFactory = client();
    emptyFactory.getCode.mockResolvedValue("0x");
    await expect(lookupRecoveryProject(emptyFactory, factory, 12n)).rejects.toThrow(/deployed/);
    const unregistered = client();
    unregistered.readContract.mockResolvedValue("0x0000000000000000000000000000000000000000");
    await expect(lookupRecoveryProject(unregistered, factory, 12n)).rejects.toThrow(/registered/);
  });
});
