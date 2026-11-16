import {
  ShopCartProvider,
  ShopCartsProvider,
  useShopCart,
} from "@/app/[slug]/components/v6/ShopCartContext";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

const item = {
  tierId: 1n,
  quantity: 1,
  price: 1n,
  currency: 1,
  hook: "0x4444444444444444444444444444444444444444" as const,
  chainId: 1,
};

function Count() {
  const cart = useShopCart();
  return <button onClick={() => cart.add(item)}>{cart.items.length} items</button>;
}

// The project route remounts its provider when the URL's chain changes.
const route = (slug: string, scope: string) => (
  <ShopCartsProvider>
    <ShopCartProvider key={slug} scope={scope}>
      <Count />
    </ShopCartProvider>
  </ShopCartsProvider>
);

describe("the shop cart across routes", () => {
  it("survives a change of chain route within the project", () => {
    const view = render(route("eth:4", "group-a"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("1 items")).toBeInTheDocument();
    view.rerender(route("base:4", "group-a"));
    expect(screen.getByText("1 items")).toBeInTheDocument();
  });

  it("stays with its project", () => {
    const view = render(route("eth:4", "group-a"));
    fireEvent.click(screen.getByRole("button"));
    view.rerender(route("eth:5", "group-b"));
    expect(screen.getByText("0 items")).toBeInTheDocument();
  });
});
