import { Header } from "@/app/[slug]/components/Header/Header";
import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participants: vi.fn(),
}));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteParticipants: mocks.participants,
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBProject: () => ({ projectId: 45n }),
  useJBProjectMetadataContext: () => ({ metadata: { data: { name: "Test project" } } }),
  useJBTokenContext: () => ({}),
}));
vi.mock("@/lib/nana/suckers", () => ({ useSuckers: () => ({ data: [] }) }));
vi.mock("@/components/IpfsImage", () => ({ IpfsImage: () => null, ImageWithFallback: () => null }));
vi.mock("@/components/SafeBadge", () => ({ SafeBadge: () => null }));
vi.mock("@/components/ProjectLink", () => ({ ProjectLink: () => null }));
vi.mock("@/app/[slug]/components/Header/TvlDatum", () => ({ TvlDatum: () => null }));

beforeEach(() => {
  mocks.participants
    .mockReset()
    .mockReturnValue({ data: undefined, isError: false, isLoading: false, isFetching: false });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

async function mount(suckerGroupId = "group") {
  const operatorPromise = Promise.resolve(null);
  await act(async () => {
    render(
      <Suspense fallback="Loading header">
        <Header
          isRevnet
          createdAt={0}
          operatorPromise={operatorPromise}
          projects={[
            {
              chainId: 1,
              projectId: 45,
              suckerGroupId,
              token: null,
              decimals: null,
              balance: "0",
              tokenSymbol: null,
            },
          ]}
        />
      </Suspense>,
    );
  });
}

describe("project holder count", () => {
  it("shows unknown when the participant query is disabled without a group", async () => {
    await mount("");
    expect(await screen.findByTitle("Owner data is unavailable.")).toHaveTextContent("—");
    expect(screen.queryByText("0+")).not.toBeInTheDocument();
    expect(mocks.participants).toHaveBeenCalledWith(
      { suckerGroupId: "", balance_gt: "0" },
      1,
      false,
    );
  });

  it("shows unknown for missing or failed participant reads", async () => {
    mocks.participants.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      isFetching: false,
    });
    await mount();
    expect(await screen.findByTitle("Owner data is unavailable.")).toHaveTextContent("—");
  });

  it("keeps a confirmed empty result as zero", async () => {
    mocks.participants.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
      isFetching: false,
    });
    await mount();
    expect(await screen.findByText("0", { exact: true })).toBeInTheDocument();
    expect(screen.queryByTitle("Owner data is unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByText("0+")).not.toBeInTheDocument();
  });

  it("shows loading while a real group is being fetched", async () => {
    mocks.participants.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      isFetching: true,
    });
    await mount();
    expect(await screen.findByText("…", { exact: true })).toBeInTheDocument();
  });
});
