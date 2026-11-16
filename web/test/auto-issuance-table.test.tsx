import { V6AutoIssuanceSubtab } from "@/app/[slug]/components/v6/owners/V6AutoIssuanceSubtab";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const HASH = "0x4d564818fe4e6fb24ab8e88fb0d34de07a793c5fe7d089d74cdc858cecc8f3d4";
const row = {
  chainId: 1,
  projectId: 3,
  version: 6,
  stageId: "100",
  beneficiary: "0x6b92c73682f0e1fac35a18ab17efa5e77dde9fe1",
  count: "1130130258069698905346873",
};

vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteStoredAutoIssuances: () => ({ data: [{ ...row, id: "stored" }] }),
  // The indexer's id is a UUID (live: eaacb6ec-f509-4e9f-82c3-df4a98377e7e), not a hash.
  useCompleteAutoIssueEvents: () => ({
    data: [{ ...row, id: "eaacb6ec-f509-4e9f-82c3-df4a98377e7e", txHash: HASH }],
  }),
}));
vi.mock("@/hooks/useAllRulesetsByChain", () => ({
  useAllRulesetsByChain: () => ({ data: { 1: [{ id: 100, start: 1 }] } }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
  useJBContractContext: () => ({ contractAddress: () => "0x" }),
  useJBChainId: () => 1,
  useChain: () => undefined,
}));
vi.mock("wagmi", () => ({ useAccount: () => ({}) }));
vi.mock("wagmi/actions", () => ({ getPublicClient: () => undefined }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => <span>chain</span> }));
vi.mock("@/app/[slug]/owners/components/OwnerDistributionBatchButton", () => ({
  OwnerDistributionBatchButton: () => null,
}));

describe("auto issuance table", () => {
  it("links a distributed row to its full transaction hash", () => {
    render(<V6AutoIssuanceSubtab projects={[{ chainId: 1, projectId: 3 }] as never} />);
    const link = screen.getByRole("link", { name: "0x4d56...f3d4" });
    expect(link).toHaveAttribute("href", `https://etherscan.io/tx/${HASH}`);
  });

  it("abbreviates the amount, keeps the exact value on hover and shows every row", () => {
    const { container } = render(
      <V6AutoIssuanceSubtab projects={[{ chainId: 1, projectId: 3 }] as never} />,
    );
    const amount = screen.getByText("1.13M REV");
    expect(amount).toHaveAttribute("title", "1,130,130.258069698905346873 REV");
    expect(container.querySelector(".max-h-96")).toBeNull();
  });

  it("asks the indexer for the transaction hash", () => {
    const source = readFileSync("src/lib/bendystraw/registry.server.ts", "utf8");
    expect(source).toMatch(
      /items \{ id chainId projectId version stageId beneficiary count txHash \}/u,
    );
  });
});
