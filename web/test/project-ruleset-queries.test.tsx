import { useAllRulesetsByChain } from "@/hooks/useAllRulesetsByChain";
import { useFetchProjectRulesets } from "@/hooks/useFetchProjectRulesets";
import { projectRulesetsQueryOptions, useRulesets } from "@/hooks/useRulesets";
import type { RawRuleset } from "@/lib/nana/rulesets";
import { RulesetWeight, WeightCutPercent } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readContract: vi.fn(), client: vi.fn() }));
const RULESETS = "0x0000000000000000000000000000000000001234";
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi/actions", () => ({ getPublicClient: mocks.client }));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 10,
  useJBContractContext: () => ({
    projectId: 7n,
    contractAddress: () => "0x0000000000000000000000000000000000001234",
  }),
}));

function row(id: number, basedOnId = 0): RawRuleset {
  return {
    cycleNumber: id,
    id,
    basedOnId,
    start: id * 100,
    duration: 100,
    weight: BigInt(id) * 10n ** 18n,
    weightCutPercent: 100_000_000,
    approvalHook: zeroAddress,
    metadata: 0n,
  };
}

beforeEach(() => {
  mocks.client.mockReturnValue({ readContract: mocks.readContract });
  mocks.readContract.mockResolvedValue([row(2, 1), row(1)]);
});

describe("project ruleset query", () => {
  it("keeps complete chronological history and typed display values", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(useRulesets, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.rulesets?.map((value) => value.id)).toEqual([1, 2]);
    expect(result.current.rulesets?.[0]?.weight).toBeInstanceOf(RulesetWeight);
    expect(result.current.rulesets?.[0]?.weightCutPercent).toBeInstanceOf(WeightCutPercent);
    expect(result.current.rulesets?.[0]?.weight.value).toBe(10n ** 18n);
    const displayed = result.current.rulesets;
    rerender();
    expect(result.current.rulesets).toBe(displayed);
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: RULESETS,
        functionName: "allOf",
        args: [7n, 0n, 100n],
      }),
    );
  });

  it("reuses fresh history and never turns an incomplete read into an empty result", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectRulesetsQueryOptions(10, 7n, RULESETS);
    const first = await client.fetchQuery(options);
    expect(await client.fetchQuery(options)).toBe(first);
    expect(mocks.readContract).toHaveBeenCalledTimes(1);
    expect(typeof first[0].weight).toBe("bigint");
    await client.invalidateQueries({ queryKey: options.queryKey });
    mocks.readContract.mockRejectedValueOnce(new Error("chain unavailable"));
    await expect(client.fetchQuery(options)).rejects.toThrow("chain unavailable");
    expect(client.getQueryData(options.queryKey)).toBe(first);
  });
});

describe("shared ruleset history", () => {
  const projects = [
    { chainId: 10 as const, projectId: 7 },
    { chainId: 8453 as const, projectId: 9 },
  ];
  const suckers = [{ peerChainId: 10 as const, projectId: 7n }];

  function mountAll(client: QueryClient) {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(
      () => ({
        single: useRulesets(),
        grouped: useAllRulesetsByChain(projects),
        editor: useFetchProjectRulesets(suckers),
      }),
      { wrapper },
    );
  }

  it("deduplicates in-flight and repeated Terms, Owners and editor reads", async () => {
    let resolveHome!: (rows: RawRuleset[]) => void;
    const home = new Promise<RawRuleset[]>((resolve) => {
      resolveHome = resolve;
    });
    let resolvePeer!: (rows: RawRuleset[]) => void;
    const peer = new Promise<RawRuleset[]>((resolve) => {
      resolvePeer = resolve;
    });
    mocks.readContract.mockImplementation(({ args }) => (args[0] === 7n ? home : peer));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = mountAll(client);
    await waitFor(() => expect(mocks.readContract).toHaveBeenCalledTimes(2));
    await act(async () => resolveHome([row(2, 1), row(1)]));
    await waitFor(() => expect(view.result.current.single.isSuccess).toBe(true));
    expect(view.result.current.grouped.isLoading).toBe(true);
    expect(view.result.current.grouped.data).toBeUndefined();
    expect(
      view.result.current.editor.suckerPairsWithRulesets?.[0].rulesets.map((r) => r.id),
    ).toEqual([1, 2]);
    await act(async () => resolvePeer([row(4)]));
    await waitFor(() => expect(view.result.current.grouped.data?.[8453]?.[0].id).toBe(4));
    expect(view.result.current.grouped.isLoading).toBe(false);
    view.unmount();
    const revisit = mountAll(client);
    expect(revisit.result.current.grouped.data?.[10]?.[0].id).toBe(1);
    expect(mocks.readContract).toHaveBeenCalledTimes(2);
  });

  it("expires history after 60 seconds and exposes new raw data to every selector", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectRulesetsQueryOptions(10, 7n, RULESETS);
    await client.fetchQuery(options);
    now.mockReturnValue(1_059_999);
    await client.fetchQuery(options);
    expect(mocks.readContract).toHaveBeenCalledTimes(1);
    mocks.readContract.mockResolvedValue([row(3, 2), row(2, 1), row(1)]);
    now.mockReturnValue(1_060_000);
    expect((await client.fetchQuery(options)).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(mocks.readContract).toHaveBeenCalledTimes(2);
    const view = mountAll(client);
    await waitFor(() => expect(view.result.current.grouped.isLoading).toBe(false));
    expect(view.result.current.single.rulesets?.[2].weight.value).toBe(3n * 10n ** 18n);
    expect(view.result.current.grouped.data?.[10]?.[2].weight).toBe(3n * 10n ** 18n);
    expect(view.result.current.editor.suckerPairsWithRulesets?.[0].rulesets[2].weight).toBe(
      3n * 10n ** 18n,
    );
  });

  it("invalidates all observers together, preserves error evidence and recovers", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = mountAll(client);
    await waitFor(() => expect(view.result.current.grouped.isLoading).toBe(false));
    expect(mocks.readContract).toHaveBeenCalledTimes(2);
    const previous = view.result.current.grouped.data;
    const options = projectRulesetsQueryOptions(10, 7n, RULESETS);
    mocks.readContract.mockRejectedValueOnce(new Error("chain unavailable"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: options.queryKey });
    });
    await waitFor(() => expect(view.result.current.grouped.isError).toBe(true));
    expect(view.result.current.grouped.data).toEqual(previous);
    expect(view.result.current.single.error?.message).toBe("chain unavailable");
    expect(view.result.current.editor.suckerPairsWithRulesets).toBeUndefined();
    expect(view.result.current.editor.error?.message).toBe("chain unavailable");
    mocks.readContract.mockResolvedValue([row(5)]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: options.queryKey });
    });
    await waitFor(() => expect(view.result.current.grouped.isError).toBe(false));
    expect(view.result.current.grouped.data?.[10]?.[0].id).toBe(5);
    expect(view.result.current.single.rulesets?.[0].id).toBe(5);
    expect(view.result.current.editor.suckerPairsWithRulesets?.[0].rulesets[0].id).toBe(5);
    expect(mocks.readContract).toHaveBeenCalledTimes(4);
  });

  it("isolates chain, project, rulesets contract and legacy class-shaped persistence", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["all-rulesets", 10, "7"], [{ ...row(99), weight: { value: 99n } }]);
    const queries = [
      projectRulesetsQueryOptions(10, 7n, RULESETS),
      projectRulesetsQueryOptions(8453, 7n, RULESETS),
      projectRulesetsQueryOptions(10, 8n, RULESETS),
      projectRulesetsQueryOptions(10, 7n, zeroAddress),
    ];
    const values = await Promise.all(queries.map((options) => client.fetchQuery(options)));
    expect(mocks.readContract).toHaveBeenCalledTimes(4);
    expect(values.every((rows) => rows[0].id === 1 && typeof rows[0].weight === "bigint")).toBe(
      true,
    );
  });
});
