// @vitest-environment jsdom
import { PayNoticeNote } from "@/app/[slug]/components/v6/pay/PayNoticeNote";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("the note under the pay form", () => {
  it("offers a retry for a notice that failed to load, and blocks nothing", () => {
    const retry = vi.fn();
    render(<PayNoticeNote view={{ notice: "", failed: true, others: [] }} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("lists the chains whose notice reads differently", () => {
    render(
      <PayNoticeNote
        view={{ notice: "Terms", failed: false, others: [{ chainId: 10, notice: "" }] }}
        retry={() => {}}
      />,
    );
    expect(screen.getByText(/The notice differs on/)).toBeTruthy();
    expect(screen.getByText("No notice.")).toBeTruthy();
  });

  it("says nothing when the notice loaded and reads the same everywhere", () => {
    const { container } = render(
      <PayNoticeNote view={{ notice: "Terms", failed: false, others: [] }} retry={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
});
