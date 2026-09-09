import { PendingLaunchNotice } from "@/components/telligence/PendingLaunchNotice";
import { pendingLaunchKey } from "@/lib/telligence/pending-launch";
import { DEFAULT_COMPUTE_DRAFT } from "@/lib/telligence/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as string | undefined,
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }) }));
const ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const saved = {
  version: 1,
  creator: ADDRESS,
  factory: "0x2222222222222222222222222222222222222222",
  hash: HASH,
  preparationId: "11111111-1111-4111-8111-111111111111",
  draft: {
    ...DEFAULT_COMPUTE_DRAFT,
    name: "Public archive",
    purpose: "Make historical research accessible to everyone.",
    workload: "Summarize archival documents",
  },
};

beforeEach(() => {
  mocks.address = ADDRESS;
  localStorage.clear();
});

describe("saved launch notice", () => {
  it("restores the confirmed-intent draft without asking for another deployment", async () => {
    localStorage.setItem(pendingLaunchKey(ADDRESS), JSON.stringify(saved));
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const removes = vi.spyOn(Storage.prototype, "removeItem");
    const onResume = vi.fn();
    render(<PendingLaunchNotice onResume={onResume} />);
    expect(await screen.findByText("Public archive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect the saved transaction" })).toHaveAttribute(
      "href",
      `https://basescan.org/tx/${HASH}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume project registration" }));
    expect(onResume).toHaveBeenCalledWith(saved.draft);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows no notice without a saved record or connected wallet", () => {
    const { rerender } = render(<PendingLaunchNotice onResume={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    localStorage.setItem(pendingLaunchKey(ADDRESS), JSON.stringify(saved));
    mocks.address = undefined;
    rerender(<PendingLaunchNotice onResume={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Public archive")).not.toBeInTheDocument();
  });

  it.each([
    "not JSON",
    JSON.stringify({ ...saved, creator: "0x3333333333333333333333333333333333333333" }),
    JSON.stringify({ ...saved, hash: "javascript:alert(1)" }),
  ])("preserves an invalid record and explains why it cannot restore it", async (raw) => {
    localStorage.setItem(pendingLaunchKey(ADDRESS), raw);
    const onResume = vi.fn();
    render(<PendingLaunchNotice onResume={onResume} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("saved launch could not be read");
    expect(
      screen.queryByRole("button", { name: "Resume project registration" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(pendingLaunchKey(ADDRESS))).toBe(raw);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("clears the old wallet's notice on an account change", async () => {
    localStorage.setItem(pendingLaunchKey(ADDRESS), JSON.stringify(saved));
    const { rerender } = render(<PendingLaunchNotice onResume={vi.fn()} />);
    await screen.findByText("Public archive");
    mocks.address = "0x3333333333333333333333333333333333333333";
    rerender(<PendingLaunchNotice onResume={vi.fn()} />);
    expect(screen.queryByText("Public archive")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("rechecks storage on click and requires review when another tab replaced the intent", async () => {
    localStorage.setItem(pendingLaunchKey(ADDRESS), JSON.stringify(saved));
    const onResume = vi.fn();
    render(<PendingLaunchNotice onResume={onResume} />);
    await screen.findByText("Public archive");
    const replacement = {
      ...saved,
      hash: `0x${"cd".repeat(32)}`,
      draft: { ...saved.draft, name: "New project" },
    };
    localStorage.setItem(pendingLaunchKey(ADDRESS), JSON.stringify(replacement));
    fireEvent.click(screen.getByRole("button", { name: "Resume project registration" }));
    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByText("New project")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("changed");
    fireEvent.click(screen.getByRole("button", { name: "Resume project registration" }));
    expect(onResume).toHaveBeenCalledWith(replacement.draft);
  });

  it("updates the notice when a same-origin tab registers or replaces the saved launch", async () => {
    render(<PendingLaunchNotice onResume={vi.fn()} />);
    localStorage.setItem(pendingLaunchKey(ADDRESS), JSON.stringify(saved));
    fireEvent(
      window,
      new StorageEvent("storage", { key: pendingLaunchKey(ADDRESS), storageArea: localStorage }),
    );
    expect(await screen.findByText("Public archive")).toBeInTheDocument();
    localStorage.removeItem(pendingLaunchKey(ADDRESS));
    fireEvent(
      window,
      new StorageEvent("storage", { key: pendingLaunchKey(ADDRESS), storageArea: localStorage }),
    );
    await waitFor(() => expect(screen.queryByText("Public archive")).not.toBeInTheDocument());
  });
});
