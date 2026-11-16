import { OperatedProjects } from "@/app/account/[id]/components/OperatedProjects";
import type { AccountPermissionHolderRow } from "@/lib/bendystraw/types";
import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permissions: vi.fn() }));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteAccountPermissions: mocks.permissions,
}));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ChainLogo", () => ({
  ChainLogo: ({ chainId }: { chainId: number }) => <span>Chain {chainId}</span>,
}));
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a {...props} />
  ),
}));

const OPERATOR = "0xcccccccccccccccccccccccccccccccccccccccc";
const FIRST = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const holder = (overrides: Partial<AccountPermissionHolderRow>): AccountPermissionHolderRow => ({
  chainId: 1,
  projectId: 0,
  version: 6,
  account: FIRST,
  operator: OPERATOR,
  permissions: [1],
  isRevnetOperator: false,
  project: null,
  ...overrides,
});

describe("account operated projects", () => {
  it("keeps global grants unlinked and separate by grantor and chain", () => {
    mocks.permissions.mockReturnValue({
      data: [
        holder({ permissions: [1] }),
        holder({ account: SECOND, permissions: [2], isRevnetOperator: true }),
        holder({ account: getAddress(FIRST), permissions: [4, 1] }),
        holder({ chainId: 8453, permissions: [5] }),
        holder({ account: "0xdddddddddddddddddddddddddddddddddddddddd", permissions: [] }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<OperatedProjects address={OPERATOR} />);

    const scopes = screen.getAllByText("All projects");
    expect(scopes).toHaveLength(3);
    const [first, second, base] = scopes.map((label) =>
      within(label.parentElement!.parentElement!),
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Project #0")).toBeNull();
    expect(first.getByText("Chain 1")).toBeInTheDocument();
    expect(first.getByText(FIRST)).toBeInTheDocument();
    expect(first.getAllByText(/^#[0-9]+$/u).map((node) => node.textContent)).toEqual(["#1", "#4"]);
    expect(first.queryByText(SECOND)).toBeNull();
    expect(first.queryByText("Revnet operator")).toBeNull();
    expect(second.getByText(SECOND)).toBeInTheDocument();
    expect(second.getByText("#2")).toBeInTheDocument();
    expect(second.queryByText("#1")).toBeNull();
    expect(second.getByText("Revnet operator")).toBeInTheDocument();
    expect(base.getByText("Chain 8453")).toBeInTheDocument();
    expect(base.getByText(FIRST)).toBeInTheDocument();
    expect(base.getByText("#5")).toBeInTheDocument();
    expect(mocks.permissions).toHaveBeenCalledWith({ operator: OPERATOR, version: 6 });
  });

  it("retains positive project links, combined project grants and attribution", () => {
    mocks.permissions.mockReturnValue({
      data: [
        holder({
          projectId: 4,
          permissions: [24],
          project: { name: "Project Four", handle: null },
        }),
        holder({ projectId: 4, account: SECOND, permissions: [26], isRevnetOperator: true }),
        holder({ chainId: 8453, projectId: 3, permissions: [1] }),
        holder({ permissions: [2] }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<OperatedProjects address={OPERATOR} />);

    const project = screen.getByRole("link", { name: "Project Four" });
    expect(project).toHaveAttribute("href", "/eth:4");
    expect(screen.getByRole("link", { name: "Project #3" })).toHaveAttribute("href", "/base:3");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    const row = within(project.parentElement!.parentElement!);
    expect(row.getByText(FIRST)).toBeInTheDocument();
    expect(row.getByText(SECOND)).toBeInTheDocument();
    expect(row.getByText("#24")).toBeInTheDocument();
    expect(row.getByText("#26")).toBeInTheDocument();
    expect(row.getByText("Revnet operator")).toBeInTheDocument();
    expect(row.queryByText("#2")).toBeNull();
    expect(screen.getByText("All projects").closest("a")).toBeNull();
  });
});
