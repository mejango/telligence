import { HomepageActivityFeed } from "@/app/HomepageActivityFeed";
import { TooltipProvider } from "@/components/ui/tooltip";
import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { expect, it, vi } from "vitest";

vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/IpfsImage", () => ({ IpfsImage: () => null }));
vi.mock("@/components/IssuanceFingerprint", () => ({ IssuanceFingerprint: () => null }));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/hooks/useInfiniteScroll", () => ({ useInfiniteScroll: () => () => {} }));

const event = {
  id: "1",
  chainId: 8453,
  txHash: "0xabc",
  timestamp: 1_700_000_000,
  project: { projectId: 3, name: "Markee", tokenSymbol: "ETH", decimals: 18 },
  payEvent: {
    id: "1",
    txHash: "0xabc",
    timestamp: 1_700_000_000,
    from: "0x1111111111111111111111111111111111111111",
    beneficiary: "0x1111111111111111111111111111111111111111",
    amount: "30000000000000",
    amountUsd: "0",
    newlyIssuedTokenCount: "1000000000000000000",
    memo: "",
    token: "0x000000000000000000000000000000000000eeee",
    decimals: 18,
    tokenSymbol: "ETH",
  },
} as unknown as ComponentProps<typeof HomepageActivityFeed>["initialEvents"][number];

it("gives the amount a line the relative time does not share", () => {
  render(
    <TooltipProvider>
      <HomepageActivityFeed initialEvents={[event]} initialHasMore={false} />
    </TooltipProvider>,
  );
  const amount = screen.getByText("0.00003 ETH");
  const time = document.querySelector("time");
  expect(time).not.toBeNull();
  // The amount's row: its span, then the group with the in/out tag, then the row.
  expect(amount.parentElement?.parentElement?.contains(time)).toBe(false);
});

it("says what a bridge send sends and where", () => {
  const send = {
    id: "2",
    chainId: 1,
    txHash: "0xdef",
    timestamp: 1_700_000_000,
    project: { projectId: 3, name: "Markee", tokenSymbol: "ETH", decimals: 18 },
    payEvent: null,
    bridgeToOutboxEvent: {
      txHash: "0xdef",
      timestamp: 1_700_000_000,
      caller: "0x1111111111111111111111111111111111111111",
      peerChainId: 8453,
      projectTokenCount: "100130000000000000000",
      sucker: "0x2222222222222222222222222222222222222222",
    },
  } as unknown as ComponentProps<typeof HomepageActivityFeed>["initialEvents"][number];
  render(
    <TooltipProvider>
      <HomepageActivityFeed initialEvents={[send]} initialHasMore={false} />
    </TooltipProvider>,
  );
  expect(document.body.textContent).toMatch(/sending 100\.13 \S+ to Base/);
});
