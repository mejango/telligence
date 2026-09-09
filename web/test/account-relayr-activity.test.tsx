import { AccountActivity } from "@/app/account/[id]/components/AccountActivity";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"aa".repeat(32)}` as const;
const mocks = vi.hoisted(() => ({
  activities: [] as TransactionActivity[],
  indexed: [] as { id: string; txHash: string; chainId: number }[],
  waitForRelayrBundle: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/useReviewedRelayr", () => ({ waitForRelayrBundle: mocks.waitForRelayrBundle }));
vi.mock("@/hooks/useViewedAccount", () => ({ useViewedAccount: () => ({ address: ACCOUNT }) }));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteAccountActivity: () => ({ data: {}, isLoading: false, isError: false }),
}));
vi.mock("@/lib/bendystraw/accountActivity", () => ({ mergeAccountActivity: () => mocks.indexed }));
vi.mock("@/lib/transaction-activity", () => ({ useTransactionActivities: () => mocks.activities }));
vi.mock("@/app/[slug]/components/ActivityFeed/mapActivityEvents", () => ({
  mapActivityEvents: () => [],
}));
vi.mock("@/app/[slug]/components/ActivityFeed/ActivityItem", () => ({
  ActivityItemRow: () => null,
}));
vi.mock("@/components/ProfilesContext", () => ({
  ProfilesProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: PropsWithChildren) => children,
}));

function activity(overrides: Partial<TransactionActivity> = {}): TransactionActivity {
  return {
    id: "relayr:bundle",
    kind: "relayr-bundle",
    account: ACCOUNT,
    title: "Update recipients",
    message: "Waiting for destination confirmation",
    status: "pending",
    bundleUuid: "bundle-1",
    hash: HASH,
    relayrPaymentStatus: "confirmed",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.activities = [];
  mocks.indexed = [];
});

describe("account Relayr recovery controls", () => {
  it.each(["unfunded", "reverted"] as const)(
    "does not offer a bundle check for %s payment",
    (relayrPaymentStatus) => {
      mocks.activities = [activity({ relayrPaymentStatus })];
      render(<AccountActivity address={ACCOUNT} />);
      expect(screen.getByText("Update recipients")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check bundle" })).not.toBeInTheDocument();
    },
  );

  it.each([
    { status: "failed" as const, manualVerificationRequired: false },
    { status: "success" as const, manualVerificationRequired: true },
  ])("offers verification for funded $status bundles", (overrides) => {
    mocks.activities = [activity(overrides)];
    render(<AccountActivity address={ACCOUNT} />);
    fireEvent.click(screen.getByRole("button", { name: "Check bundle" }));
    expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith("bundle-1");
  });

  it("keeps an unresolved bundle visible when its payment is already indexed", () => {
    mocks.activities = [activity({ status: "failed", manualVerificationRequired: true })];
    mocks.indexed = [{ id: "indexed-payment", txHash: HASH, chainId: 8453 }];
    render(<AccountActivity address={ACCOUNT} />);
    expect(screen.getByRole("button", { name: "Check bundle" })).toBeInTheDocument();
  });
});
