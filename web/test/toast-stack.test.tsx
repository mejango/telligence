import { toast, useToast } from "@/components/ui/use-toast";
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function ToastState() {
  const { hasOverflow, toasts } = useToast();
  return (
    <div>
      <output aria-label="Notification overflow">{hasOverflow ? "more" : "all visible"}</output>
      <ol aria-label="Notification order">
        {toasts.map(({ id, title }) => (
          <li key={id}>{title}</li>
        ))}
      </ol>
    </div>
  );
}

describe("notification stack", () => {
  it("keeps the newest three in order and folds older notices into See more", () => {
    render(<ToastState />);

    act(() => {
      toast({ title: "First" });
      toast({ title: "Second" });
      toast({ title: "Third" });
      toast({ title: "Fourth" });
    });

    expect(
      within(screen.getByRole("list", { name: "Notification order" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Fourth", "Third", "Second"]);
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Notification overflow")).toHaveTextContent("more");
  });
});
