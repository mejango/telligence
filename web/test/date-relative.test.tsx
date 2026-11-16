import { DateRelative } from "@/components/DateRelative";
import { TooltipProvider } from "@/components/ui/tooltip";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function timeOf(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>).container.querySelector("time")!;
}

describe("DateRelative", () => {
  it("is its own Tab stop on its own", () => {
    expect(timeOf(<DateRelative timestamp={1_700_000_000} />)).toHaveAttribute("tabindex", "0");
  });

  it("adds no second Tab stop inside a link", () => {
    expect(timeOf(<DateRelative timestamp={1_700_000_000} insideLink />)).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
});
