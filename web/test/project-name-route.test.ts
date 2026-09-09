import { GET } from "@/app/api/project-name/route";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/app/[slug]/getProject", () => ({ getProject: mocks.getProject }));

describe("project-name route", () => {
  beforeEach(() => mocks.getProject.mockReset());

  it("resolves one exact chain and project ID", async () => {
    mocks.getProject.mockResolvedValue({
      isRevnet: true,
      name: "Kenny's Bounty Engine Network",
      handle: null,
      suckerGroupId: "0xabc",
    });
    const response = await GET(
      new NextRequest("https://revnet.money/api/project-name?chainId=84532&projectId=11"),
    );
    expect(mocks.getProject).toHaveBeenCalledWith(11, 84532);
    await expect(response.json()).resolves.toEqual({
      found: true,
      name: "Kenny's Bounty Engine Network",
      suckerGroupId: "0xabc",
    });
  });

  it("rejects malformed IDs and non-revnet projects", async () => {
    expect(
      (
        await GET(
          new NextRequest("https://revnet.money/api/project-name?chainId=84532&projectId=nope"),
        )
      ).status,
    ).toBe(400);
    mocks.getProject.mockResolvedValue({ isRevnet: false });
    const response = await GET(
      new NextRequest("https://revnet.money/api/project-name?chainId=84532&projectId=11"),
    );
    await expect(response.json()).resolves.toMatchObject({ found: false });
  });
});
