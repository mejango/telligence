import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiquidityRangePreview } from "@/app/[slug]/components/v6/owners/market/LiquidityRangePreview";

describe("LiquidityRangePreview", () => {
  it("shows the selected position against the economic and live-price markers", () => {
    const { container } = render(
      <LiquidityRangePreview
        floor={0.001}
        ceiling={0.004}
        current={0.002}
        minimum={0.0008}
        maximum={0.0045}
        pairSymbol="USDC"
        tokenSymbol="ART"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Liquidity range in USDC per ART" }),
    ).toBeInTheDocument();
    expect(container.querySelector("rect")).not.toBeNull();
    expect(screen.getByText("Floor")).toBeInTheDocument();
    expect(screen.getByText("Current pool price")).toBeInTheDocument();
    expect(screen.getByText("Ceiling")).toBeInTheDocument();
  });
});

describe("LiquidityRangePreview drag handles", () => {
  const dragTo = (handle: Element, clientX: number) => {
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX });
    fireEvent.pointerUp(handle, { pointerId: 1 });
  };

  it("maps a pointer position back to a price and keeps the edges ordered", () => {
    const changes: Array<[string, number]> = [];
    const { container } = render(
      <LiquidityRangePreview
        floor={null}
        ceiling={null}
        current={0.002}
        minimum={0.001}
        maximum={0.004}
        pairSymbol="USDC"
        tokenSymbol="ART"
        onRangeChange={(edge, value) => changes.push([edge, value])}
      />,
    );
    const svg = container.querySelector("svg")!;
    // 320-wide viewBox with 8px padding; the axis spans 0…maximum*1.12.
    svg.getBoundingClientRect = () => ({ left: 0, width: 320 }) as DOMRect;
    const handles = container.querySelectorAll("rect.cursor-ew-resize");
    expect(handles).toHaveLength(2);

    // Halfway across the axis is half of the 0.00448 domain.
    dragTo(handles[0], 8 + (320 - 16) / 2);
    expect(changes.at(-1)![0]).toBe("minimum");
    expect(changes.at(-1)![1]).toBeCloseTo(0.00224, 6);

    // Dragging min past max clamps it below max instead of inverting.
    dragTo(handles[0], 320);
    expect(changes.at(-1)![1]).toBeLessThan(0.004);

    // Dragging max below min clamps it above min.
    dragTo(handles[1], 0);
    expect(changes.at(-1)![0]).toBe("maximum");
    expect(changes.at(-1)![1]).toBeGreaterThan(0.001);
  });

  it("renders no handles when the range is not editable", () => {
    const { container } = render(
      <LiquidityRangePreview
        floor={null}
        ceiling={null}
        current={0.002}
        minimum={0.001}
        maximum={0.004}
        pairSymbol="USDC"
        tokenSymbol="ART"
      />,
    );
    expect(container.querySelectorAll("rect.cursor-ew-resize")).toHaveLength(0);
  });
});
