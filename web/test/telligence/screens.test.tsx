import { ComputeCreateForm } from "@/components/telligence/ComputeCreateForm";
import { ComputeProjectPage } from "@/components/telligence/ComputeProjectPage";
import { ProjectDirectory } from "@/components/telligence/ProjectDirectory";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), deploy: vi.fn(), fund: vi.fn() }));
vi.mock("@/lib/telligence/api", () => ({
  gatewayRequest: mocks.request,
  gatewayOrigin: () => "https://api.example.test",
}));
vi.mock("@/components/telligence/PendingLaunchNotice", () => ({ PendingLaunchNotice: () => null }));
vi.mock("@/components/telligence/LaunchComputeProjectButton", () => ({
  LaunchComputeProjectButton: ({ draft, disabled }: { draft: unknown; disabled?: boolean }) => (
    <button disabled={disabled} onClick={() => mocks.deploy(draft)}>
      Launch project
    </button>
  ),
}));
vi.mock("@/components/telligence/FundComputeProject", () => ({
  FundComputeProject: ({ project }: { project: { name: string } }) => (
    <button onClick={() => mocks.fund(project)}>Fund {project.name}</button>
  ),
}));
const project = {
  id: "base-12",
  chainId: 8453,
  revnetId: "12",
  name: "Public archive",
  purpose: "Make historical research accessible to everyone.",
  workload: "Summarize archival documents",
  targetDailyCreditUsd: "10",
  status: "active",
  policyVersion: "1",
  createdAt: "2026-09-09T12:00:00Z",
  wrapperAddress: "0x1111111111111111111111111111111111111111",
  vaultAddress: "0x2222222222222222222222222222222222222222",
  creatorAddress: "0x3333333333333333333333333333333333333333",
  capacity: {
    status: "ready",
    dailyCreditUsd: "12.50",
    remainingCreditUsd: "4.10",
    observedAt: new Date().toISOString(),
  },
};

afterEach(cleanup);
// Braces matter: a function returned from beforeEach becomes an after-test hook,
// and `mockReset()` returns the mock, which vitest would then call after each test.
beforeEach(() => {
  mocks.request.mockReset();
});

describe("project discovery", () => {
  it("shows a real loading state followed by verified project observations", async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<ProjectDirectory />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    resolve({ projects: [project] });
    expect(await screen.findByRole("link", { name: /Public archive/ })).toHaveAttribute(
      "href",
      "/compute/base-12",
    );
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getAllByText("Humming").length).toBeGreaterThan(0);
  });
  it("distinguishes an unavailable index from an empty one and supports retry", async () => {
    mocks.request.mockRejectedValueOnce(new Error("The gateway is unavailable."));
    render(<ProjectDirectory />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The gateway is unavailable.");
    expect(screen.queryByText("Be the first to put an idea to work.")).not.toBeInTheDocument();
    mocks.request.mockResolvedValue({ projects: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Be the first to put an idea to work.")).toBeInTheDocument();
  });
  it("filters locally without misrepresenting the number of funded projects", async () => {
    mocks.request.mockResolvedValue({ projects: [project] });
    render(<ProjectDirectory />);
    await screen.findByText("Public archive");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a purpose" }), {
      target: { value: "unmatched" },
    });
    expect(screen.getByText("No projects match this search.")).toBeInTheDocument();
    expect(screen.queryByText("Be the first to put an idea to work.")).not.toBeInTheDocument();
  });
});

describe("compute project", () => {
  it("keeps actual credit separate from target, with support rights available before funding", async () => {
    mocks.request.mockResolvedValue({ project });
    render(<ComputeProjectPage projectId="base-12" />);
    expect(await screen.findByRole("heading", { name: "Public archive" })).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("$4.10")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect the revnet" })).toHaveAttribute(
      "href",
      "/base:12",
    );
    expect(screen.getByText(/Backing committed to compute/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API keys" })).toHaveAttribute(
      "href",
      "/compute/base-12/keys",
    );
    fireEvent.click(screen.getByRole("button", { name: "Fund Public archive" }));
    expect(mocks.fund).toHaveBeenCalledWith(project);
  });
  it("shows verified credit without inventing a target for projects that did not set one", async () => {
    mocks.request.mockResolvedValue({ project: { ...project, targetDailyCreditUsd: null } });
    render(<ComputeProjectPage projectId="base-12" />);
    await screen.findByRole("heading", { name: "Public archive" });
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.queryByText("Daily target")).not.toBeInTheDocument();
    expect(screen.queryByText("$null")).not.toBeInTheDocument();
  });

  it("does not offer a funding action for a closed project", async () => {
    mocks.request.mockResolvedValue({ project: { ...project, status: "closed" } });
    render(<ComputeProjectPage projectId="base-12" />);
    await screen.findByRole("heading", { name: "Public archive" });
    expect(screen.queryByRole("button", { name: "Fund Public archive" })).not.toBeInTheDocument();
    expect(screen.getByText("This project is closed to new funding.")).toBeInTheDocument();
  });
});

describe("compute launch", () => {
  it("requires purpose and concrete terms acknowledgement before enabling launch", async () => {
    mocks.request.mockResolvedValue({
      ready: true,
      policyVersion: "2",
      chainId: 8453,
      factoryAddress: "0x1111111111111111111111111111111111111111",
      canonicalTerminal: "0x2222222222222222222222222222222222222222",
      vvvAddress: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf",
      launchPolicy: {
        conversionCadence: "3600",
        minBatchTokens: "1000000000000000000",
        maxBatchTokens: "100000000000000000000000",
        minVVVPerProjectToken: "100000000000000",
        minDiemPerVVV: "10000000000000000",
        maxPrincipal: "10000000000000000000000",
        initialIssuance: "1000000000000000000000000",
      },
    });
    render(<ComputeCreateForm />);
    expect(screen.queryByLabelText(/Daily compute goal/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Explain your purpose in 20 to 4,000 characters.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Launch project" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Public archive" },
    });
    fireEvent.change(screen.getByLabelText("Why do you need compute?"), {
      target: { value: "Make historical research accessible to everyone." },
    });
    fireEvent.change(screen.getByLabelText("What will it do?"), {
      target: { value: "Summarize archival documents" },
    });
    expect(screen.getByLabelText("Operator token share")).toHaveValue("0");
    fireEvent.change(screen.getByLabelText("Operator token share"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("Operator token share")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("heading", { name: "Review your project" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Operator token share"), { target: { value: "10.25" } });
    fireEvent.click(screen.getByText("Inspect the starting terms"));
    fireEvent.change(screen.getByLabelText("Recovery wallet"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByText("0x4444444444444444444444444444444444444444"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Daily compute goal")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New token allocation")).toHaveTextContent("40%");
    expect(screen.getByLabelText("New token allocation")).toHaveTextContent("10.25%");
    expect(screen.getByLabelText("New token allocation")).toHaveTextContent("49.75%");
    expect(screen.getByRole("button", { name: "Launch project" })).toBeDisabled();
    await screen.findByRole("heading", { name: "The vault's fixed boundaries" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
    fireEvent.click(screen.getByRole("button", { name: "Launch project" }));
    expect(mocks.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Public archive",
        productionSplitBps: 4000,
        operatorSplitBps: 1025,
        cashOutTaxBps: 1000,
        targetDailyCreditUsd: "",
        recoveryAddress: "0x4444444444444444444444444444444444444444",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    expect(screen.getByLabelText("Project name")).toHaveValue("Public archive");
    expect(screen.getByLabelText("Operator token share")).toHaveValue("10.25");
    fireEvent.change(screen.getByLabelText("Operator token share"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("New token allocation")).toHaveTextContent("20%");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Launch project" })).toBeDisabled(),
    );
  });
});

describe("compute project during a gateway outage", () => {
  const savedAt = "2026-09-09T11:30:00.000Z";
  it("shows the saved purpose with a stale notice and no funding or live capacity", async () => {
    mocks.request.mockRejectedValue(new Error("The gateway is unavailable."));
    render(
      <ComputeProjectPage
        projectId="base-12"
        initialProject={{ project: project as never, at: savedAt }}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Public archive" })).toBeInTheDocument();
    expect(screen.getByText(/Make historical research accessible/)).toBeInTheDocument();
    expect(screen.getByText("Summarize archival documents")).toBeInTheDocument();
    expect(screen.getByText("0x2222222222222222222222222222222222222222")).toBeInTheDocument();
    const notice = screen.getByRole("status", { name: /saved copy/i });
    expect(notice).toHaveTextContent(/Showing the last saved copy from/);
    expect(notice).toHaveTextContent(/live capacity and funding are unavailable/i);
    expect(notice.querySelector("time")).toHaveAttribute("dateTime", savedAt);
    expect(screen.queryByRole("button", { name: /Fund/ })).not.toBeInTheDocument();
    expect(screen.queryByText("$12.50")).not.toBeInTheDocument();
    expect(screen.queryByText("$4.10")).not.toBeInTheDocument();
    expect(screen.queryByText("Remaining today")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recover backing directly on Base" })).toHaveAttribute(
      "href",
      "/recover?project=12",
    );
    expect(screen.getByRole("link", { name: "Inspect the revnet" })).toHaveAttribute(
      "href",
      "/base:12",
    );
  });
  it("prefers the live project over the saved copy once the gateway answers", async () => {
    mocks.request.mockResolvedValue({ project: { ...project, name: "Live archive" } });
    render(
      <ComputeProjectPage
        projectId="base-12"
        initialProject={{ project: project as never, at: savedAt }}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Live archive" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /saved copy/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fund Live archive" })).toBeInTheDocument();
  });
  it("keeps the plain error when there is no saved copy", async () => {
    mocks.request.mockRejectedValue(new Error("The gateway is unavailable."));
    render(<ComputeProjectPage projectId="base-12" initialProject={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The gateway is unavailable.");
    expect(screen.queryByRole("heading", { name: "Public archive" })).not.toBeInTheDocument();
  });
});
