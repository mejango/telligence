import { CheckDeploymentButton } from "@/app/[slug]/components/CheckDeploymentButton";
import {
  ProjectDataNotice,
  ProjectDiagnosticsProvider,
} from "@/app/[slug]/components/ProjectDiagnostics";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  refresh: vi.fn(),
  copy: vi.fn(),
  evict: vi.fn(),
}));
vi.mock("@/app/[slug]/invalidateProjectDisplay", () => ({ refreshProjectDisplay: mocks.evict }));
vi.mock("@/lib/projectDiagnostics", () => ({ loadProjectDiagnostics: mocks.load }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const report = {
  indexer: { project: "unavailable", group: "missing" },
  deployment: {
    version: 6,
    chainId: 1,
    projectId: "45",
    kind: "revnet",
    checkedBlock: "123",
    checkedAt: "2026-10-04T12:00:00.000Z",
    checks: [
      {
        id: "hook-project",
        category: "hook",
        status: "mismatch",
        label: "Hook project",
        message: "The hook belongs to another project.",
        actual: "44",
        expected: "45",
        action: "Use the hook created for this project.",
      },
    ],
  },
};
const availableReport = {
  ...report,
  indexer: { project: "available", group: "available" },
};
function mount(
  notice = false,
  chainId: JBChainId = 1,
  projectId = 45n,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectDiagnosticsProvider chainId={chainId} projectId={projectId}>
        {notice ? (
          <ProjectDataNotice
            status={{ project: "unavailable", group: "missing" }}
            project={{ chainId: 1, projectId: 45, groupId: "group" }}
          />
        ) : (
          <CheckDeploymentButton />
        )}
      </ProjectDiagnosticsProvider>
    </QueryClientProvider>,
  );
  return { ...view, invalidate, client };
}

beforeEach(() => {
  mocks.load.mockReset();
  mocks.refresh.mockReset();
  mocks.evict.mockReset().mockResolvedValue(undefined);
  mocks.copy.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
});

describe("project diagnostics", () => {
  it("checksums both the actual and expected addresses", async () => {
    const lower = "0x5aff29060e023e6fb87be5596652b33c65af535b";
    const checksummed = "0x5AfF29060E023e6FB87BE5596652B33c65Af535B";
    mocks.load.mockResolvedValue({
      ...availableReport,
      deployment: {
        ...report.deployment,
        checks: [
          {
            ...report.deployment.checks[0],
            status: "passed",
            actual: checksummed,
            expected: lower,
          },
        ],
      },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findAllByText(checksummed)).toHaveLength(2);
    expect(screen.queryByText(lower)).toBeNull();
  });

  it.each(["available", "not-checked"])(
    "reuses complete findings with group %s until ten seconds, then refreshes",
    async (group) => {
      let now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => now);
      mocks.load.mockResolvedValue({
        ...availableReport,
        indexer: { project: "available", group },
      });
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
      await screen.findByText("The hook belongs to another project.");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      now += 9_999;
      fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
      expect(screen.getByText("The hook belongs to another project.")).toBeInTheDocument();
      expect(screen.queryByText("Checking deployment…")).not.toBeInTheDocument();
      expect(mocks.load).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      now += 1;
      fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
      await screen.findByText("The hook belongs to another project.");
      expect(mocks.load).toHaveBeenCalledTimes(2);
    },
  );

  it("honors invalidation and explicit retry and operator checks while findings are fresh", async () => {
    mocks.load.mockResolvedValue(availableReport);
    const { client } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
    await screen.findByText("The hook belongs to another project.");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Check an operator's shop permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
    await screen.findByText("The hook belongs to another project.");
    expect(mocks.load).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(() =>
      client.invalidateQueries({ queryKey: ["project-deployment-diagnostics", 1, "45", null] }),
    );
    expect(mocks.load).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    expect(mocks.load).toHaveBeenCalledTimes(4);
  });

  it("isolates findings by chain, project and operator and reuses them after remount", async () => {
    mocks.load.mockResolvedValue(availableReport);
    const first = mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    const operator = "0x1111111111111111111111111111111111111111";
    const otherOperator = "0x2222222222222222222222222222222222222222";
    fireEvent.click(screen.getByRole("checkbox", { name: "Check an operator's shop permissions" }));
    for (const address of [operator, otherOperator, operator]) {
      fireEvent.change(screen.getByRole("textbox", { name: "Operator address" }), {
        target: { value: address },
      });
      fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
      await screen.findByText("The hook belongs to another project.");
      expect(screen.getByText(`Operator checked: ${address}`)).toBeInTheDocument();
    }
    expect(mocks.load).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
    await screen.findByText("The hook belongs to another project.");
    expect(mocks.load).toHaveBeenLastCalledWith(1, 45n, operator);
    first.unmount();
    for (const [chainId, projectId] of [
      [10, 45n],
      [1, 46n],
      [1, 45n],
    ] as const) {
      const view = mount(false, chainId, projectId, first.client);
      fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
      await screen.findByText("The hook belongs to another project.");
      view.unmount();
    }
    expect(mocks.load.mock.calls).toEqual([
      [1, 45n, undefined],
      [1, 45n, operator],
      [1, 45n, otherOperator],
      [1, 45n, operator],
      [10, 45n, undefined],
      [1, 46n, undefined],
    ]);
  });

  it("shares an in-flight check across close and reopen", async () => {
    let resolve!: (value: typeof availableReport) => void;
    mocks.load.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("Checking deployment…");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    resolve(availableReport);
    await screen.findByText("The hook belongs to another project.");
  });

  it.each([
    ["failed deployment read", { ...availableReport, deployment: null }],
    ["failed project read", report],
    [
      "failed group read",
      { ...availableReport, indexer: { project: "available", group: "unavailable" } },
    ],
    [
      "missing project",
      { ...availableReport, indexer: { project: "missing", group: "not-checked" } },
    ],
    [
      "incomplete project",
      { ...availableReport, indexer: { project: "incomplete", group: "available" } },
    ],
    [
      "incomplete group",
      { ...availableReport, indexer: { project: "available", group: "incomplete" } },
    ],
    [
      "failed deployment check",
      {
        ...availableReport,
        deployment: {
          ...report.deployment,
          checks: [{ ...report.deployment.checks[0], status: "unavailable" }],
        },
      },
    ],
  ])("retries %s immediately on reopen", async (_name, degraded) => {
    mocks.load.mockResolvedValueOnce(degraded).mockResolvedValue(availableReport);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry checks" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("is opt-in, shows loading, and separates onchain findings from data-service failure", async () => {
    let resolve!: (value: typeof report) => void;
    mocks.load.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findByText("Checking deployment…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
    resolve(report);
    expect(await screen.findByText("The hook belongs to another project.")).toBeInTheDocument();
    expect(screen.getByText("Needs attention", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("Use the hook created for this project.")).toBeInTheDocument();
    expect(screen.getByText(/request failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByText("Diagnostics copied.")).toBeInTheDocument();
    expect(JSON.parse(mocks.copy.mock.calls[0][0])).toMatchObject({
      chainId: 1,
      projectId: "45",
      ...report,
    });
  });

  it("sanitizes errors and can retry checks and copying", async () => {
    mocks.load
      .mockRejectedValueOnce(new Error("https://secret-rpc.invalid/key-secret"))
      .mockResolvedValue(report);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deployment checks are unavailable");
    expect(document.body.textContent).not.toContain("key-secret");
    fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
    expect(await screen.findByText("The hook belongs to another project.")).toBeInTheDocument();
    mocks.copy.mockRejectedValueOnce(new Error("clipboard disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByText("Could not copy diagnostics. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByText("Diagnostics copied.")).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("retries the degraded page's server and client data and offers diagnostics", async () => {
    mocks.load.mockResolvedValue(report);
    const { invalidate, client } = mount(true);
    const readKeys = [
      ["bendystraw", "project", 1],
      ["complete-participants", { suckerGroupId: "group" }, 1],
      ["complete-activity-events", { suckerGroupId: "group" }, 1],
      ["pending-routing-payments", "1:45"],
    ];
    for (const key of readKeys) client.setQueryData(key, []);
    expect(screen.queryByText(/hasn't finished indexing/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.evict).toHaveBeenCalledWith([{ chainId: 1, projectId: 45, groupId: "group" }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["bendystraw"] });
    for (const key of readKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findByRole("dialog", { name: "Check deployment" })).toBeInTheDocument();
  });
  it("keeps Retry available when server display eviction fails", async () => {
    mocks.evict.mockRejectedValueOnce(new Error("connection failed"));
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not refresh project data");
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });
  it("validates optional operators and only switches the report after an explicit check", async () => {
    mocks.load.mockResolvedValue(report);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    fireEvent.click(screen.getByRole("checkbox", { name: "Check an operator's shop permissions" }));
    const input = screen.getByRole("textbox", { name: "Operator address" });
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid operator address.");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    const operator = "0x1111111111111111111111111111111111111111";
    fireEvent.change(input, { target: { value: operator } });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
    await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(1, 45n, operator));
  });
  it("does not present or copy an earlier report after a retry fails", async () => {
    mocks.load
      .mockResolvedValueOnce(availableReport)
      .mockRejectedValueOnce(new Error("RPC retry failed"))
      .mockResolvedValue(availableReport);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deployment checks are unavailable");
    expect(screen.queryByText("The hook belongs to another project.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    expect(mocks.load).toHaveBeenCalledTimes(3);
  });
});
