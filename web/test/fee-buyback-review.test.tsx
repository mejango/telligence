// @vitest-environment jsdom
import type { useFeeBuybackReview } from "@bananapus/nana-sdk-core/review/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeeBuybackNotice } from "../src/components/FeeBuybackNotice";

// Core's useFeeBuybackReview owns the checks, block refreshes and confirmation; this covers what
// the notice shows of its state.
type Review = ReturnType<typeof useFeeBuybackReview>;
const fee = {
  key: "base:6",
  projectId: 6n,
  beneficiary: "0x6666666666666666666666666666666666666666",
  received: 9429n * 10n ** 18n,
  route: "fallback",
};
const review = (patch: Partial<Review>): Review =>
  ({
    enabled: true,
    status: "fallback",
    result: { status: "fallback", fees: [fee], checkedAt: Date.now() },
    busy: false,
    settled: true,
    waiting: false,
    autoRefresh: true,
    confirmLabel: null,
    confirm: vi.fn(),
    retry: vi.fn(),
    wait: vi.fn(),
    ...patch,
  }) as unknown as Review;

describe("the fee return notice", () => {
  it("shows a fallback's return and offers to wait for a better rate", () => {
    const shown = review({});
    render(<FeeBuybackNotice review={shown} />);
    expect(document.body.textContent).toContain("9,429");
    expect(document.body.textContent).toContain("tokens to 0x6666…6666");
    expect(document.body.textContent).toContain("Checking new blocks automatically");
    fireEvent.click(screen.getByRole("button", { name: "Wait for better rate" }));
    expect(shown.wait).toHaveBeenCalledOnce();
  });

  it("shows a pending first check as checking, never as unavailable", () => {
    render(<FeeBuybackNotice review={review({ busy: true, settled: false })} />);
    expect(document.body.textContent).toContain("Checking fee return…");
    expect(document.body.textContent).not.toContain("unavailable");
    expect(screen.queryByRole("button", { name: "Retry now" })).toBeNull();
  });

  it("offers a retry when the return is unknown and nothing watches new blocks", () => {
    const shown = review({
      status: "unknown",
      result: { status: "unknown", fees: [] },
      autoRefresh: false,
    });
    render(<FeeBuybackNotice review={shown} />);
    expect(document.body.textContent).toContain("Automatic checks unavailable. Retry now.");
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(shown.retry).toHaveBeenCalledOnce();
  });
});
