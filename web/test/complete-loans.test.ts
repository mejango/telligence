import { fetchCompleteLoans, fetchLoansByAccount } from "@/hooks/useCompleteBendystrawLists";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bendystraw/client", () => ({
  queryBendystrawFromBrowser: vi.fn(),
}));

const query = vi.mocked(queryBendystrawFromBrowser);

describe("fetchCompleteLoans", () => {
  beforeEach(() => query.mockReset());

  it("uses exact project refs instead of independent id and chain lists", async () => {
    query.mockResolvedValue({
      loans: {
        totalCount: 2,
        items: [
          {
            id: "base",
            borrowAmount: "1",
            collateral: "2",
            beneficiary: "0x0000000000000000000000000000000000000001",
            owner: "0x0000000000000000000000000000000000000001",
            createdAt: 2,
            chainId: 8453,
            projectId: 6,
            version: 6,
          },
          {
            id: "op",
            borrowAmount: "1",
            collateral: "2",
            beneficiary: "0x0000000000000000000000000000000000000001",
            owner: "0x0000000000000000000000000000000000000001",
            createdAt: 1,
            chainId: 10,
            projectId: 42,
            version: 6,
          },
        ],
      },
    } as never);

    await fetchCompleteLoans([
      { chainId: 8453, projectId: 6, version: 6 },
      { chainId: 10, projectId: 42, version: 6 },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: {
          OR: [
            { AND: [{ chainId: 8453 }, { projectId: 6 }, { version: 6 }] },
            { AND: [{ chainId: 10 }, { projectId: 42 }, { version: 6 }] },
          ],
        },
      }),
    );
  });

  it("fails closed when Bendystraw returns a cross-product match", async () => {
    query.mockResolvedValue({
      loans: {
        totalCount: 1,
        items: [
          {
            id: "wrong",
            borrowAmount: "1",
            collateral: "2",
            beneficiary: "0x0000000000000000000000000000000000000001",
            owner: "0x0000000000000000000000000000000000000001",
            createdAt: 1,
            chainId: 10,
            projectId: 6,
            version: 6,
          },
        ],
      },
    } as never);

    await expect(
      fetchCompleteLoans([
        { chainId: 8453, projectId: 6, version: 6 },
        { chainId: 10, projectId: 42, version: 6 },
      ]),
    ).rejects.toThrow("wrong deployment");
  });
});

describe("fetchLoansByAccount", () => {
  beforeEach(() => query.mockReset());

  const OWNER = "0x0000000000000000000000000000000000000001";

  function loan(id: string) {
    return {
      id,
      borrowAmount: "1",
      collateral: "2",
      prepaidDuration: 0,
      projectId: 6,
      terminal: "0x0000000000000000000000000000000000000002",
      token: "0x000000000000000000000000000000000000EEEe",
      chainId: 8453,
      createdAt: 1,
      project: { version: 6 },
    };
  }

  it("pages until the reported total instead of returning one server page", async () => {
    query
      .mockResolvedValueOnce({
        loans: { totalCount: 260, items: Array.from({ length: 250 }, (_, i) => loan(`a${i}`)) },
      } as never)
      .mockResolvedValueOnce({
        loans: { totalCount: 260, items: Array.from({ length: 10 }, (_, i) => loan(`b${i}`)) },
      } as never);

    const rows = await fetchLoansByAccount(OWNER, 6, 8453);

    expect(rows).toHaveLength(260);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { owner: OWNER, version: 6, limit: 250, offset: 0 },
      8453,
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { owner: OWNER, version: 6, limit: 250, offset: 250 },
      8453,
    );
  });

  it("fails closed when a page comes back empty before the reported total", async () => {
    query.mockResolvedValue({ loans: { totalCount: 260, items: [] } } as never);

    await expect(fetchLoansByAccount(OWNER, 6)).rejects.toThrow("before its reported total");
  });
});
