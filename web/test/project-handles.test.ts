import {
  JB_PROJECT_HANDLES_ADDRESS,
  PROJECT_HANDLE_CHAIN_ID,
  canonicalProjectHandle,
  ensTextResolverAbi,
  jbProjectHandlesAbi,
  parseProjectHandleInput,
  parseProjectHandleRecord,
  projectHandleProgress,
  projectHandleRecord,
  readExactEnsText,
  readExactProjectHandle,
  sameProjectHandleParts,
  simulateExactEnsTextWrite,
} from "@/lib/projectHandles";
import {
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  padHex,
  sliceHex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";

const RESOLVER = "0x2222222222222222222222222222222222222222";
const NODE = `0x${"11".repeat(32)}` as const;

describe("project handles", () => {
  // wallet-action:project-handle
  it("resumes the two-step flow without duplicating either completed record", () => {
    expect(projectHandleProgress(false, false)).toEqual({
      ensRecordComplete: false,
      reverseClaimComplete: false,
      complete: false,
      nextAction: "ens",
    });
    expect(projectHandleProgress(true, false)).toMatchObject({
      complete: false,
      nextAction: "publish",
    });
    expect(projectHandleProgress(false, true)).toMatchObject({
      reverseClaimComplete: true,
      complete: false,
      nextAction: "ens",
    });
    expect(projectHandleProgress(true, true)).toMatchObject({
      complete: true,
      nextAction: null,
    });
  });

  it("normalizes the public syntax and reverses ENS labels for the contract", () => {
    expect(parseProjectHandleInput("banny.eth")).toEqual({
      handle: "banny",
      ensName: "banny.eth",
      parts: ["banny"],
    });
    expect(parseProjectHandleInput("  @design.juicebox  ")).toEqual({
      handle: "design.juicebox",
      ensName: "design.juicebox.eth",
      parts: ["juicebox", "design"],
    });
    expect(parseProjectHandleInput("DESIGN.JUICEBOX.ETH")).toEqual({
      handle: "design.juicebox",
      ensName: "design.juicebox.eth",
      parts: ["juicebox", "design"],
    });
  });

  it("rejects malformed and contract-incompatible names", () => {
    for (const input of ["", "@", "foo@bar", "foo..bar", "foo eth", "foo.eth.bar"]) {
      expect(() => parseProjectHandleInput(input)).toThrow();
    }
  });

  it("strictly parses supported chainId:projectId records", () => {
    expect(parseProjectHandleRecord("8453:42")).toEqual({
      chainId: 8453,
      projectId: 42n,
      slug: "base:42",
    });
    for (const value of [null, "", "8453:0", "0:42", "8453:42 ", "base:42", "999:42"]) {
      expect(parseProjectHandleRecord(value)).toBeNull();
    }
    expect(projectHandleRecord(8453, 42n)).toBe("8453:42");
  });

  it("pins the Ethereum registry call and exact reverse-label arguments", () => {
    expect(PROJECT_HANDLE_CHAIN_ID).toBe(1);
    expect(JB_PROJECT_HANDLES_ADDRESS).toBe("0x726f4a3dfd2fb8297f8ab98d215b42a92d8eefe8");

    const data = encodeFunctionData({
      abi: jbProjectHandlesAbi,
      functionName: "setEnsNamePartsFor",
      args: [8453n, 42n, ["juicebox", "design"]],
    });
    expect(decodeFunctionData({ abi: jbProjectHandlesAbi, data })).toEqual({
      functionName: "setEnsNamePartsFor",
      args: [8453n, 42n, ["juicebox", "design"]],
    });
  });

  it("compares stored parts without accepting prefixes or reordered labels", () => {
    expect(sameProjectHandleParts(["juicebox", "design"], ["juicebox", "design"])).toBe(true);
    expect(sameProjectHandleParts(["design", "juicebox"], ["juicebox", "design"])).toBe(false);
    expect(sameProjectHandleParts(["juicebox"], ["juicebox", "design"])).toBe(false);
  });

  it("accepts contract handles only when the raw value is already canonical", () => {
    expect(canonicalProjectHandle("design.juicebox")?.ensName).toBe("design.juicebox.eth");
    for (const value of ["DESIGN.JUICEBOX", "design.juicebox.eth", "@design.juicebox", " x "]) {
      expect(canonicalProjectHandle(value)).toBeNull();
    }
  });

  it("reads resolver text with a raw gas-capped call and bounded ABI decoding", async () => {
    const encoded = encodeFunctionResult({
      abi: ensTextResolverAbi,
      functionName: "text",
      result: "8453:42",
    });
    const request = vi.fn().mockResolvedValue(encoded);
    const client = { request } as unknown as PublicClient;

    await expect(readExactEnsText(client, RESOLVER, NODE)).resolves.toBe("8453:42");
    expect(request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [
        expect.objectContaining({
          from: JB_PROJECT_HANDLES_ADDRESS,
          to: RESOLVER,
          gas: "0x1e848",
        }),
        "latest",
      ],
    });

    request.mockResolvedValueOnce(concatHex([padHex("0x40", { size: 32 }), sliceHex(encoded, 32)]));
    await expect(readExactEnsText(client, RESOLVER, NODE)).resolves.toBeNull();

    request.mockResolvedValueOnce(
      encodeFunctionResult({
        abi: ensTextResolverAbi,
        functionName: "text",
        result: "x".repeat(257),
      }),
    );
    await expect(readExactEnsText(client, RESOLVER, NODE)).resolves.toBeNull();
  });

  it("does not follow resolver CCIP redirects", async () => {
    const request = vi.fn().mockRejectedValue(new Error("OffchainLookup"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      readExactEnsText({ request } as unknown as PublicClient, RESOLVER, NODE),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("simulates resolver writes with raw bounded no-CCIP semantics", async () => {
    const request = vi.fn().mockResolvedValue("0x");
    const client = { request } as unknown as PublicClient;
    const account = "0x1111111111111111111111111111111111111111";

    await expect(
      simulateExactEnsTextWrite(client, RESOLVER, NODE, "8453:42", account),
    ).resolves.toBe(500_000n);
    expect(request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [
        expect.objectContaining({
          from: account,
          to: RESOLVER,
          gas: "0x7a120",
        }),
        "latest",
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    request.mockRejectedValueOnce(new Error("OffchainLookup"));
    await expect(
      simulateExactEnsTextWrite(client, RESOLVER, NODE, "8453:42", account),
    ).rejects.toThrow("OffchainLookup");
    expect(fetchSpy).not.toHaveBeenCalled();

    request.mockResolvedValueOnce(`0x${"00".repeat(33)}`);
    await expect(
      simulateExactEnsTextWrite(client, RESOLVER, NODE, "8453:42", account),
    ).rejects.toThrow("invalid simulation result");
    fetchSpy.mockRestore();
  });

  it("bounds the reverse handle call before decoding contract storage", async () => {
    const encoded = encodeFunctionResult({
      abi: jbProjectHandlesAbi,
      functionName: "handleOf",
      result: "design.juicebox",
    });
    const request = vi.fn().mockResolvedValue(encoded);
    const client = { request } as unknown as PublicClient;
    const setter = "0x1111111111111111111111111111111111111111";

    await expect(readExactProjectHandle(client, 8453, 42n, setter)).resolves.toBe(
      "design.juicebox",
    );
    expect(request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [
        expect.objectContaining({ to: JB_PROJECT_HANDLES_ADDRESS, gas: "0x493e0" }),
        "latest",
      ],
    });

    request.mockResolvedValueOnce(
      encodeFunctionResult({
        abi: jbProjectHandlesAbi,
        functionName: "handleOf",
        result: "x".repeat(257),
      }),
    );
    await expect(readExactProjectHandle(client, 8453, 42n, setter)).resolves.toBeNull();
  });
});
