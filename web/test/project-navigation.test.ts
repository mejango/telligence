import {
  clearProjectNavigationHints,
  getProjectNavigationHint,
  rememberProjectNavigation,
} from "@/lib/project-navigation";
import { beforeEach, describe, expect, it } from "vitest";

describe("project navigation hints", () => {
  beforeEach(clearProjectNavigationHints);

  it("keeps the identity visible across destination URL variants", () => {
    rememberProjectNavigation("/base:7#owners", {
      name: " Marquee ",
      logoUri: " ipfs://logo ",
      tagline: " Ready now ",
      ticker: " MARK ",
    });

    expect(getProjectNavigationHint("/base:7?view=compact")).toEqual({
      name: "Marquee",
      logoUri: "ipfs://logo",
      tagline: "Ready now",
      ticker: "MARK",
    });
  });

  it("does not cache an empty identity", () => {
    rememberProjectNavigation("/base:7", { name: " ", logoUri: null });
    expect(getProjectNavigationHint("/base:7")).toBeNull();
  });
});
