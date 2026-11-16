import { ProjectRouteBoundary } from "@/app/[slug]/ProjectRouteBoundary";
import { ProjectPageBoundary, useProjectNavigation } from "@/app/[slug]/ProjectRouteContext";
import { PROJECT_ROUTE_TTL_MS, type ProjectRouteSnapshot } from "@/app/[slug]/projectRouteIdentity";
import {
  invalidateProjectRouteProofs,
  projectRouteQueryKey,
  verifyProjectRoute,
} from "@/app/[slug]/projectRouteQuery";
import { ModalDialog } from "@/components/ui/ModalShell";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

const router = vi.hoisted(() => ({
  replaceDocument: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  pathname: "/@design/owners",
}));
vi.mock("@/lib/projectSubtabNavigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectSubtabNavigation")>()),
  replaceProjectDocument: router.replaceDocument,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => router.pathname,
}));
const original: ProjectRouteSnapshot = {
  chainId: 8453,
  projectId: "42",
  authority: `0x${"1".repeat(40)}`,
  localCheckedAt: 1_000_000,
  checkedAt: 1_000_000,
};
let now = original.checkedAt!;
const proof = (snapshot = original) => ({ ...snapshot, checkedAt: now, localCheckedAt: now });
const response = (snapshot: ProjectRouteSnapshot = proof()) =>
  new Response(JSON.stringify({ ...snapshot, serverNow: now }));
const deferred = () => {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  now = original.checkedAt!;
  router.pathname = "/@design/owners";
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

describe("alias proof reuse", () => {
  it("reuses actual proof age, coalesces expiry checks and isolates aliases", async () => {
    const client = new QueryClient();
    const read = deferred();
    const fetcher = vi.fn().mockReturnValue(read.promise);
    vi.stubGlobal("fetch", fetcher);
    now += PROJECT_ROUTE_TTL_MS - 1;
    expect(await verifyProjectRoute(client, "@design", original)).toEqual(original);
    expect(fetcher).not.toHaveBeenCalled();
    now++;
    const a = verifyProjectRoute(client, "@design", original);
    const b = verifyProjectRoute(client, "%40design", original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    read.resolve(response());
    await expect(a).resolves.toMatchObject(proof());
    await expect(b).resolves.toMatchObject(proof());
    now += 4_999;
    await verifyProjectRoute(client, "@design", original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => response());
    await verifyProjectRoute(client, "@different", original);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never renews expired/error proof or accepts stale endpoint payloads", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    client.setQueryData(projectRouteQueryKey("@design"), original);
    await expect(verifyProjectRoute(client, "@design", original, true)).rejects.toThrow("offline");
    await expect(verifyProjectRoute(client, "@design", original)).rejects.toThrow("offline");
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += PROJECT_ROUTE_TTL_MS;
    fetcher.mockResolvedValue(response(original));
    await expect(verifyProjectRoute(client, "@design", original)).rejects.toThrow("expired");
    expect(client.getQueryData(projectRouteQueryKey("@design"))).toEqual(original);
    fetcher.mockImplementation(async () => response());
    await expect(verifyProjectRoute(client, "@design", original)).resolves.toMatchObject(proof());
  });

  it("cancels a pre-mutation proof and cannot reuse it or the initial lease afterward", async () => {
    const client = new QueryClient();
    client.setQueryData(projectRouteQueryKey("@design"), original);
    const read = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(read.promise);
    vi.stubGlobal("fetch", fetcher);
    const old = verifyProjectRoute(client, "@design", original, true).catch((error) => error);
    await invalidateProjectRouteProofs(client);
    read.resolve(response(original));
    await old;
    const rebound = { ...original, projectId: "43" };
    fetcher.mockResolvedValueOnce(response(rebound));
    expect(await verifyProjectRoute(client, "@design", original)).toMatchObject(rebound);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function Controls({ send = () => {} }: { send?: () => void }) {
  const navigate = useProjectNavigation();
  const [count, setCount] = useState(0);
  return (
    <>
      <button
        data-project-navigation="local"
        onClick={() => navigate(() => setCount((value) => value + 1))}
      >
        View {count}
      </button>
      {createPortal(<button onClick={send}>Send</button>, document.body)}
    </>
  );
}

function tree(client: QueryClient, snapshot = original, page = snapshot, send?: () => void) {
  return (
    <QueryClientProvider client={client}>
      <ProjectRouteBoundary slug="@design" snapshot={snapshot}>
        <ProjectPageBoundary snapshot={page}>
          <Controls send={send} />
        </ProjectPageBoundary>
      </ProjectRouteBoundary>
    </QueryClientProvider>
  );
}

describe("retained project boundary", () => {
  it("keeps same-identity state, checks once on expired navigation and never polls idle", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetcher);
    render(tree(client));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    fireEvent.click(screen.getByText("View 0"));
    expect(await screen.findByText("View 1")).toBeInTheDocument();
    now += 30_000;
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("View 1"));
    await screen.findByText("View 2");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("View 2"));
    expect(await screen.findByText("View 3")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps failures gated and retries without a document reload", async () => {
    const send = vi.fn();
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    render(tree(new QueryClient(), original, original, send));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    now += PROJECT_ROUTE_TTL_MS;
    fireEvent.click(screen.getByText("View 0"));
    await screen.findByRole("alert");
    await screen.findByRole("alert");
    fetcher.mockImplementation(async () => response());
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("replaces the document exactly once for a positively verified changed binding", async () => {
    const client = new QueryClient();
    const next = { ...original, projectId: "43", authority: `0x${"2".repeat(40)}` };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response(proof(next))),
    );
    render(tree(client));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    now += PROJECT_ROUTE_TTL_MS;
    fireEvent.click(screen.getByText("View 0"));
    await screen.findByText("This handle changed. Loading the current project…");
    expect(router.replaceDocument).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(router.replaceDocument).toHaveBeenCalledOnce();
  });

  it("hides a changed child immediately before refreshing retained providers", async () => {
    const client = new QueryClient();
    const next = { ...original, projectId: "43" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response(proof(next))),
    );
    const view = render(tree(client));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    view.rerender(tree(client, original, next));
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
    await waitFor(() => expect(router.replaceDocument).toHaveBeenCalledOnce());
  });

  it("retains the mounted binding when same-alias server props change to a newly verified project", async () => {
    const client = new QueryClient();
    const view = render(tree(client));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    now += PROJECT_ROUTE_TTL_MS;
    const next = { ...original, projectId: "43", authority: `0x${"2".repeat(40)}` };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response(proof(next))),
    );
    view.rerender(tree(client, next, next));
    await waitFor(() => expect(router.replaceDocument).toHaveBeenCalledOnce());
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  it("rechecks expired history and BFCache restores, coalescing concurrent reads", async () => {
    const read = deferred();
    const fetcher = vi.fn().mockReturnValue(read.promise);
    vi.stubGlobal("fetch", fetcher);
    render(tree(new QueryClient()));
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
    now += PROJECT_ROUTE_TTL_MS;
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      read.resolve(response());
    });
    await waitFor(() =>
      expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );
  });
});

describe("clock-independent alias lease", () => {
  it.each([-3_600_000, 3_600_000])(
    "charges server age and roundtrip despite clock skew %d",
    async (skew) => {
      const start = now;
      const fetcher = vi.fn(async () => {
        now += 500;
        return new Response(
          JSON.stringify({ ...original, checkedAt: start + skew, serverNow: start + skew + 200 }),
        );
      });
      vi.stubGlobal("fetch", fetcher);
      const client = new QueryClient();
      const serverSnapshot = { ...original, checkedAt: start + skew, localCheckedAt: undefined };
      const verified = await verifyProjectRoute(client, "@design", serverSnapshot);
      expect(verified.localCheckedAt).toBe(start - 200);
      now = start + 4_799;
      await verifyProjectRoute(client, "@design", serverSnapshot);
      expect(fetcher).toHaveBeenCalledOnce();
      now++;
      await verifyProjectRoute(client, "@design", serverSnapshot);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects slow response and honors explicit invalidation before TTL", async () => {
    const client = new QueryClient();
    client.setQueryData(projectRouteQueryKey("@design"), original);
    await client.invalidateQueries({ queryKey: projectRouteQueryKey("@design") });
    const fetcher = vi.fn(async () => {
      now += PROJECT_ROUTE_TTL_MS;
      return response();
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(verifyProjectRoute(client, "@design", original)).rejects.toThrow("expired");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(client.getQueryData(projectRouteQueryKey("@design"))).toEqual(original);
  });
});

function LocalModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit</button>
      {open ? (
        <ModalDialog onClose={() => setOpen(false)} labelledBy="edit-title">
          <div>
            <h2 id="edit-title">Edit project</h2>
            <input aria-label="Draft" />
            <button onClick={() => setOpen(false)}>Close</button>
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

it("releases native modal top layer on failed history proof and restores its draft after retry", async () => {
  const client = new QueryClient();
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider client={client}>
      <ProjectRouteBoundary slug="@design" snapshot={original}>
        <ProjectPageBoundary snapshot={original}>
          <LocalModal />
        </ProjectPageBoundary>
      </ProjectRouteBoundary>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText("Edit").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false"),
  );
  fireEvent.click(screen.getByText("Edit"));
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "saved form" } });
  expect(openModalDialogs()).toHaveLength(1);
  now += PROJECT_ROUTE_TTL_MS;
  act(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await screen.findByRole("alert");
  expect(openModalDialogs()).toHaveLength(0);
  expect(isBlockedByModalDialog(screen.getByText("Retry"))).toBe(false);
  fetcher.mockImplementation(async () => response());
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByRole("dialog", { name: "Edit project" });
  expect(screen.getByLabelText("Draft")).toHaveValue("saved form");
  fireEvent.click(screen.getByText("Close"));
  expect(openModalDialogs()).toHaveLength(0);
});

it("settles a history check when Next commits its pathname during the request", async () => {
  const read = deferred();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(read.promise));
  const client = new QueryClient();
  const view = render(tree(client));
  await waitFor(() =>
    expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false"),
  );
  now += PROJECT_ROUTE_TTL_MS;
  act(() => window.dispatchEvent(new PopStateEvent("popstate")));
  router.pathname = "/@design/terms";
  view.rerender(tree(client));
  await act(async () => {
    read.resolve(response());
  });
  await waitFor(() =>
    expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false"),
  );
});

it("replaces a changed server snapshot arriving outside an initiated refresh", async () => {
  const client = new QueryClient();
  const next = { ...original, projectId: "43" };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => response(proof(next))),
  );
  const view = render(tree(client));
  await waitFor(() =>
    expect(screen.getByText("View 0").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false"),
  );
  view.rerender(tree(client, next, next));
  await waitFor(() => expect(router.replaceDocument).toHaveBeenCalledOnce());
});
