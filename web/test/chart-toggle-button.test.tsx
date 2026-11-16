import { ChartToggleButton } from "@/app/[slug]/components/TokenPrice/ChartToggleButton";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[slug]/ProjectRouteContext", () => ({
  useProjectNavigation: () => (run: () => void) => run(),
}));

describe("ChartToggleButton", () => {
  it.each([
    [true, false, "true"],
    [false, false, "false"],
    [true, true, "false"],
  ])("active %s, disabled %s reports aria-pressed %s", (active, disabled, pressed) => {
    render(
      <ChartToggleButton
        label="Pool"
        active={active}
        disabled={disabled}
        colorVar="--chart-1"
        onClick={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Pool" })).toHaveAttribute("aria-pressed", pressed);
  });
});
