import { V6SplitsSubtab } from "@/app/[slug]/components/v6/owners/V6SplitsSubtab";
import type { ProjectItem } from "@/app/[slug]/components/v6/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogProps = vi.hoisted(() => ({ last: undefined as Record<string, unknown> | undefined }));
const distributionProps = vi.hoisted(() => ({
  last: undefined as Record<string, unknown> | undefined,
}));
const reads = vi.hoisted(() => ({
  splits: [] as Array<{ percent: number; beneficiary: string; hook: string }>,
  // reservedPercent lives in ruleset metadata bits 4-19, out of 10_000.
  reservedPercentBps: [250n, 40n],
  /** Extra chains in the rulesets map, keyed by chain id → number of stages. */
  extraChainStages: {} as Record<number, number>,
  splitsContracts: [] as Array<{ functionName: string; args: readonly unknown[] }>,
  controllers: {} as Record<number, string>,
  pending: {} as Record<number, bigint>,
  pendingContracts: [] as Array<{ chainId: number; address: string; args: readonly unknown[] }>,
}));

vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({
    projectId: 3n,
    contractAddress: () => "0x0000000000000000000000000000000000000001",
  }),
  useJBChainId: () => 8453,
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
}));

vi.mock("@/lib/bendystraw", () => ({
  useBendystrawQuery: () => ({ data: undefined, isLoading: false }),
  ProjectOperatorOperation: "ProjectOperatorOperation",
}));

vi.mock("@/hooks/useAllRulesetsByChain", () => ({
  useAllRulesetsByChain: () => {
    const data: Record<number, Array<{ id: number; start: number; metadata: bigint }>> = {
      8453: [
        {
          id: 1_700_000_001,
          start: 1_700_000_001,
          metadata: reads.reservedPercentBps[0] << 4n,
        },
        {
          id: 1_700_000_002,
          start: 1_700_000_002,
          metadata: reads.reservedPercentBps[1] << 4n,
        },
      ],
    };
    for (const [chainId, stages] of Object.entries(reads.extraChainStages)) {
      data[Number(chainId)] = Array.from({ length: stages }, (_, index) => ({
        id: 1_800_000_001 + index,
        start: 1_800_000_001 + index,
        metadata: reads.reservedPercentBps[0] << 4n,
      }));
    }
    return { data, isLoading: false };
  },
}));

vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectPermissions: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/app/[slug]/owners/components/DistributeReservedTokensButton", () => ({
  DistributeReservedTokensButton: (props: Record<string, unknown>) => {
    distributionProps.last = props;
    return null;
  },
}));
vi.mock("@/app/[slug]/owners/components/ChangeSplitRecipientsDialog", () => ({
  ChangeSplitRecipientsDialog: (props: Record<string, unknown>) => {
    dialogProps.last = props;
    return <div data-testid="change-splits-dialog" />;
  },
}));

vi.mock("wagmi", () => ({
  useReadContracts: ({
    contracts,
  }: {
    contracts: Array<{
      chainId: number;
      address: string;
      functionName: string;
      args: readonly unknown[];
    }>;
  }) => {
    if (contracts.length === 0) return { data: undefined, isLoading: false };
    if (contracts[0].functionName === "splitsOf") {
      reads.splitsContracts = contracts.filter((c) => c.functionName === "splitsOf");
    }
    if (contracts[0].functionName === "pendingReservedTokenBalanceOf") {
      reads.pendingContracts = contracts;
    }
    if (contracts[0].functionName === "allOf") {
      // JBRulesets.allOf returns newest-first; the component reverses it.
      return {
        data: [
          {
            status: "success",
            result: [
              {
                id: 1_700_000_002,
                start: 1_700_000_002,
                metadata: reads.reservedPercentBps[1] << 4n,
              },
              {
                id: 1_700_000_001,
                start: 1_700_000_001,
                metadata: reads.reservedPercentBps[0] << 4n,
              },
            ],
          },
        ],
        isLoading: false,
      };
    }
    return {
      data: contracts.map((contract) => ({
        status: "success",
        result:
          contract.functionName === "splitsOf"
            ? reads.splits
            : contract.functionName === "controllerOf"
              ? (reads.controllers[contract.chainId] ??
                "0x0000000000000000000000000000000000000000")
              : (reads.pending[contract.chainId] ?? 0n),
      })),
      isLoading: false,
    };
  },
}));

const projects = [{ chainId: 8453, projectId: 3, token: null }] as unknown as ProjectItem[];

beforeEach(() => {
  dialogProps.last = undefined;
  distributionProps.last = undefined;
  reads.controllers = {};
  reads.pending = {};
  reads.pendingContracts = [];
  reads.extraChainStages = {};
  reads.splitsContracts = [];
  reads.splits = [
    {
      percent: 1_000_000_000,
      beneficiary: "0x000000000000000000000000000000000000dEaD",
      hook: "0x0000000000000000000000000000000000000000",
    },
  ];
  reads.reservedPercentBps = [250n, 40n];
});

describe("V6SplitsSubtab stage selection", () => {
  it("hands the change dialog the stage INDEX, not the ruleset id", () => {
    render(<V6SplitsSubtab projects={projects} />);

    // Both fixture stages have started, so the tabs open on the current one.
    expect(dialogProps.last?.stageIdx).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /^Stage 1/ }));
    expect(dialogProps.last?.stageIdx).toBe(0);
    expect(dialogProps.last).not.toHaveProperty("stageId");
  });
});

describe("V6SplitsSubtab split percentages", () => {
  it("keeps a fractional split limit intact", () => {
    render(<V6SplitsSubtab projects={projects} />);
    fireEvent.click(screen.getByRole("button", { name: /^Stage 1/ }));

    expect(screen.getByText(/The split limit for this stage is/)).toHaveTextContent("2.5%");
    // 100% of a 2.5% limit is 2.5% of issuance — not the 3% a rounded limit gives.
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("2.5%");
  });

  it("does not round a sub-1% split limit down to zero", () => {
    render(<V6SplitsSubtab projects={projects} />);
    fireEvent.click(screen.getByRole("button", { name: /^Stage 2/ }));

    expect(screen.getByText(/The split limit for this stage is/)).toHaveTextContent("0.4%");
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("0.4%");
  });
});

describe("V6SplitsSubtab per-chain stage resolution", () => {
  const twoChains = [
    { chainId: 8453, projectId: 3, token: null },
    { chainId: 10, projectId: 12, token: null },
  ] as unknown as ProjectItem[];

  it("never reads the FALLBACK group for a chain with no ruleset at the selected index", () => {
    // Optimism has only one stage; the home chain has two. `splitsOf(pid, 0, …)` serves the
    // FALLBACK group, so a `?? 0n` id would render another group's recipients as stage 2's.
    reads.extraChainStages = { 10: 1 };

    render(<V6SplitsSubtab projects={twoChains} />);
    fireEvent.click(screen.getByRole("button", { name: /^Stage 1/ }));
    expect(reads.splitsContracts).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /^Stage 2/ }));

    expect(reads.splitsContracts).toHaveLength(1);
    expect(reads.splitsContracts[0].args[0]).toBe(3n);
    for (const contract of reads.splitsContracts) {
      expect(contract.args[1]).not.toBe(0n);
    }
    expect(screen.getByText("This chain has no stage 2.")).toBeTruthy();
  });

  it("skips a chain whose ruleset list came back empty", () => {
    reads.extraChainStages = { 10: 0 };

    render(<V6SplitsSubtab projects={twoChains} />);
    fireEvent.click(screen.getByRole("button", { name: /^Stage 1/ }));

    expect(reads.splitsContracts).toHaveLength(1);
    expect(screen.getByText("This chain has no stage 1.")).toBeTruthy();
  });

  it("resolves pending reserves through each live controller even without the viewed historical stage", () => {
    reads.extraChainStages = { 10: 0 };
    reads.controllers = {
      8453: "0x0000000000000000000000000000000000000003",
      10: "0x0000000000000000000000000000000000000004",
    };
    reads.pending = { 8453: 31n, 10: 92n };
    render(<V6SplitsSubtab projects={twoChains} />);
    expect(reads.pendingContracts.map((call) => [call.chainId, call.address, call.args])).toEqual([
      [8453, reads.controllers[8453], [3n]],
      [10, reads.controllers[10], [12n]],
    ]);
    expect(distributionProps.last?.projects).toEqual([
      { chainId: 8453, projectId: 3n, pending: 31n },
      { chainId: 10, projectId: 12n, pending: 92n },
    ]);
  });
});
