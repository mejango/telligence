import {
  PARTICIPANTS_PAGE_SIZE,
  ParticipantsTable,
  type ParticipantRow,
} from "@/app/[slug]/owners/components/ParticipantsTable";
import type { ProjectTokenData } from "@/lib/nana/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));

vi.mock("@/components/ChainLogo", () => ({
  ChainLogo: ({ chainId }: { chainId: number }) => <span>chain-{chainId}</span>,
}));

const token = { decimals: 18, symbol: "ART" } as ProjectTokenData;

function participant(index: number): ParticipantRow {
  return {
    address: `owner-${index}`,
    balance: BigInt(100 - index),
    volume: 0n,
    chains: [1],
  };
}

describe("ParticipantsTable pagination", () => {
  it("matches Juicescan's 30-row paging controls", () => {
    const participants = Array.from({ length: 31 }, (_, index) => participant(index));
    render(
      <ParticipantsTable
        participants={participants}
        token={token}
        totalSupply={10_000n}
        condensed
      />,
    );

    const pagination = screen.getByRole("navigation", { name: "Owners table pages" });
    expect(within(pagination).getByText("1 / 2")).toBeVisible();
    expect(screen.getAllByText("owner-0")[0]).toBeVisible();
    expect(screen.queryAllByText(`owner-${PARTICIPANTS_PAGE_SIZE}`)).toHaveLength(0);

    fireEvent.click(within(pagination).getByRole("button", { name: "Next ›" }));

    expect(within(pagination).getByText("2 / 2")).toBeVisible();
    expect(screen.queryAllByText("owner-0")).toHaveLength(0);
    expect(screen.getAllByText(`owner-${PARTICIPANTS_PAGE_SIZE}`)[0]).toBeVisible();
    expect(within(pagination).getByRole("button", { name: "Next ›" })).toBeDisabled();
  });

  it("hides pagination for a single page", () => {
    render(
      <ParticipantsTable
        participants={[participant(0)]}
        token={token}
        totalSupply={10_000n}
        condensed
      />,
    );

    expect(
      screen.queryByRole("navigation", { name: "Owners table pages" }),
    ).not.toBeInTheDocument();
  });
});
