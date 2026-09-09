import {
  donutSlicePath,
  donutSliceRanges,
} from "@/app/[slug]/owners/components/ParticipantsPieChart";
import { describe, expect, it } from "vitest";

describe("owner distribution donut geometry", () => {
  it("uses straight radial boundaries from the outer ring to the inner ring", () => {
    const path = donutSlicePath(0, Math.PI / 4);
    const commands = path.split(" ");

    expect(commands.filter((command) => command === "L")).toHaveLength(1);
    expect(commands.filter((command) => command === "A")).toHaveLength(2);
    expect(path).toMatch(/^M 212\.000 112\.000 A /u);
    expect(path).toMatch(/ Z$/u);
  });

  it("places the smallest holders first and closes the largest holder at the right edge", () => {
    const ranges = donutSliceRanges([70n, 20n, 10n]);

    expect(ranges.map(({ index }) => index)).toEqual([2, 1, 0]);
    expect(ranges[0].start).toBe(0);
    expect(ranges.at(-1)!.end).toBeCloseTo(Math.PI * 2, 10);
  });
});
