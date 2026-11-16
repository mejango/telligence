import { projectViewHref } from "@/lib/projectSubtabNavigation";
import { describe, expect, it } from "vitest";

describe("client view URLs", () => {
  it.each(["@design.juicebox", "%40design.juicebox", "base:42"])(
    "preserves every other parameter and hash for %s",
    (slug) => {
      const start = `https://revnet.example/${slug}/owners?range=1m&subtab=accounts&filter=held#chart`;
      const subtab = projectViewHref(start, "subtab", "market");
      expect(subtab).toBe(
        `https://revnet.example/${slug}/owners?range=1m&subtab=market&filter=held#chart`,
      );
      expect(projectViewHref(subtab, "range", "1y")).toBe(
        `https://revnet.example/${slug}/owners?range=1y&subtab=market&filter=held#chart`,
      );
    },
  );
});
