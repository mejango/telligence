import { DistributeReservedTokensButton } from "@/app/[slug]/owners/components/DistributeReservedTokensButton";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({ contractAddress: () => "0x" }),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({}) }));
vi.mock("wagmi/actions", () => ({ getPublicClient: () => undefined }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/app/[slug]/owners/components/OwnerDistributionBatchButton", () => ({
  OwnerDistributionBatchButton: () => null,
}));

const project = { chainId: 10, projectId: 3n } as never;

describe("distribute reserved tokens balance label", () => {
  it("shows the skeleton while loading, never failure text or a loading string", () => {
    const { container } = render(
      <DistributeReservedTokensButton projects={[project]} pendingLoading tokenSymbol="REV" />,
    );
    expect(screen.queryByText(/balance unavailable/u)).toBeNull();
    expect(container.textContent).not.toMatch(/loading/iu);
    expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
    expect(container.textContent).toContain("Optimism");
  });

  it("keeps the failure text for a read that actually failed", () => {
    render(<DistributeReservedTokensButton projects={[project]} tokenSymbol="REV" />);
    expect(screen.getByText(/balance unavailable/u)).toBeInTheDocument();
  });

  it("prints the amount the way the splits table does", () => {
    render(
      <DistributeReservedTokensButton
        projects={[{ chainId: 10, projectId: 3n, pending: 75107100000000000000n } as never]}
        tokenSymbol="REV"
      />,
    );
    expect(screen.getByText("75.11 REV")).toBeInTheDocument();
  });
});
