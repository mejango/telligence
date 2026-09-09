import { ownersSubtabNavigation } from "@/app/[slug]/components/v6/owners/V6OwnersTab";
import { describe, expect, it } from "vitest";

describe("owners subtab navigation", () => {
  it("forces a document refresh for literal and encoded mutable handles", () => {
    for (const slug of ["@design.juicebox", "%40design.juicebox"]) {
      expect(
        ownersSubtabNavigation(slug, "https://revnet.example/@design.juicebox/owners", "splits"),
      ).toEqual({
        href: "https://revnet.example/@design.juicebox/owners?subtab=splits",
        mode: "document",
      });
    }
  });

  it("keeps immutable numeric project subtabs client-local", () => {
    expect(
      ownersSubtabNavigation(
        "base:42",
        "https://revnet.example/base:42/owners?subtab=accounts",
        "loans",
      ),
    ).toEqual({
      href: "https://revnet.example/base:42/owners?subtab=loans",
      mode: "client",
    });
  });
});
