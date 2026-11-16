import { readActivityRows } from "@/app/homepageActivityRows";
import { describe, expect, it } from "vitest";

const feed = (txs: number[]) =>
  txs.flatMap((count, tx) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${tx}-${i}`,
      chainId: 1,
      txHash: `0x${tx}`,
      project: { projectId: 1 },
    })),
  );

describe("readActivityRows", () => {
  it("fills the asked rows however many events each holds, and cuts where the next row opens", async () => {
    const events = feed([3, 2, 5, 1, 2, 2, 4, 2, 1, 1]);
    const read = async (limit: number, offset: number) => events.slice(offset, offset + limit);
    await expect(readActivityRows(read, 8, 0)).resolves.toEqual({
      events: events.slice(0, 21),
      hasMore: true,
    });
    await expect(readActivityRows(read, 8, 21)).resolves.toEqual({
      events: events.slice(21),
      hasMore: false,
    });
  });
});
