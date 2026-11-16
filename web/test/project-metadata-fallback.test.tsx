import { ProjectProviders } from "@/app/[slug]/ProjectProviders";
import { useJBProjectMetadataContext } from "@/lib/nana/project";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("@bananapus/nana-sdk-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core")>()),
  getProjectMetadata: mocks.metadata,
}));
vi.mock("wagmi", () => ({
  usePublicClient: () => ({}),
  useReadContract: ({ functionName }: { functionName: string }) => ({
    data:
      functionName === "controllerOf" ? "0x0000000000000000000000000000000000001234" : undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function MetadataProbe() {
  const { metadata } = useJBProjectMetadataContext();
  return (
    <>
      <p>{metadata.data?.name}</p>
      <p>{metadata.data?.description}</p>
      <p>{metadata.error?.message}</p>
      <p>{metadata.isLoading ? "Loading" : "Ready"}</p>
      <button onClick={() => void metadata.refetch?.()}>Retry metadata</button>
    </>
  );
}

function view(client: QueryClient, projectId = 7n, description = "Indexed description") {
  return (
    <QueryClientProvider client={client}>
      <ProjectProviders
        chainId={10}
        projectId={projectId}
        project={{ name: "Indexed name", logoUri: null, description }}
        projects={[{ chainId: 10, projectId: Number(projectId) }]}
      >
        <MetadataProbe />
      </ProjectProviders>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.metadata.mockImplementation(() => new Promise(() => {}));
});

describe("indexed project metadata fallback", () => {
  it("renders description immediately while the full metadata remains pending, then replaces it", async () => {
    let finish!: (value: { name: string; description: string }) => void;
    mocks.metadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(view(client));
    expect(screen.getByText("Indexed description")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));
    await act(async () => finish({ name: "Full name", description: "Full description" }));
    expect(await screen.findByText("Full description")).toBeInTheDocument();
    expect(screen.queryByText("Indexed description")).not.toBeInTheDocument();
    rendered.unmount();
    render(view(client));
    expect(screen.getByText("Full description")).toBeInTheDocument();
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
  });

  it("keeps indexed description and error evidence through a failed fetch and retry", async () => {
    mocks.metadata.mockRejectedValueOnce(new Error("metadata unavailable"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(view(client));
    expect(await screen.findByText("metadata unavailable")).toBeInTheDocument();
    expect(screen.getByText("Indexed description")).toBeInTheDocument();
    mocks.metadata.mockResolvedValueOnce({ name: "Recovered", description: "Fresh description" });
    fireEvent.click(screen.getByRole("button", { name: "Retry metadata" }));
    expect(await screen.findByText("Fresh description")).toBeInTheDocument();
    expect(screen.queryByText("metadata unavailable")).not.toBeInTheDocument();
  });

  it("switches immediately to a different project's fallback without borrowing richer metadata", async () => {
    mocks.metadata.mockResolvedValueOnce({ name: "First", description: "First rich description" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(view(client));
    expect(await screen.findByText("First rich description")).toBeInTheDocument();
    rendered.rerender(view(client, 8n, "Second indexed description"));
    expect(screen.getByText("Second indexed description")).toBeInTheDocument();
    expect(screen.queryByText("First rich description")).not.toBeInTheDocument();
  });
});
