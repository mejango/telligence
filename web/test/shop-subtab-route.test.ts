import { shopSubtabNavigation } from "@/app/[slug]/components/v6/shop/V6ShopTab";
import { describe, expect, it } from "vitest";

describe("shop subtab navigation", () => {
  it("forces a document refresh for literal and encoded mutable handles", () => {
    for (const slug of ["@design.juicebox", "%40design.juicebox"]) {
      expect(
        shopSubtabNavigation(slug, "https://revnet.example/@design.juicebox/shop", "customers"),
      ).toEqual({
        href: "https://revnet.example/@design.juicebox/shop?subtab=customers",
        mode: "document",
      });
    }
  });

  it("keeps immutable numeric project subtabs client-local", () => {
    expect(
      shopSubtabNavigation(
        "base:42",
        "https://revnet.example/base:42/shop?subtab=customers",
        "inventory",
      ),
    ).toEqual({
      href: "https://revnet.example/base:42/shop?subtab=inventory",
      mode: "client",
    });
  });
});
