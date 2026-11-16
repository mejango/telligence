import { ActivityFeed } from "@/app/[slug]/components/ActivityFeed/ActivityFeed";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const activity = vi.hoisted(() => vi.fn(() => ({ data: [], isLoading: false, isError: false })));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({ useCompleteActivityEvents: activity }));
vi.mock("@/components/ProfilesContext", () => ({
  ProfilesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/app/[slug]/components/ActivityFeed/PendingRoutingPayments", () => ({
  PendingRoutingPayments: () => null,
}));
vi.mock("@/app/[slug]/components/ActivityFeed/ActivityItem", () => ({ ActivityItem: () => null }));

describe("project activity availability", () => {
  it("does not query an empty group or claim a confirmed empty feed", () => {
    render(<ActivityFeed suckerGroupId="" projects={[]} />);
    expect(activity).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { suckerGroupId: "" } }),
      1,
      false,
    );
    expect(
      screen.getByText("Activity is temporarily unavailable. Try again shortly."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  });

  it("keeps a successful empty group result as no activity yet", () => {
    render(<ActivityFeed suckerGroupId="group" projects={[]} />);
    expect(activity).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { suckerGroupId: "group" } }),
      1,
      true,
    );
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});
