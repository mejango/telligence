import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/IpfsImage", () => ({ IpfsImage: () => null }));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("next/image", () => ({ default: () => null }));

import Page from "@/app/discover/page";

const EMPTY = "No matching revnets found.";
const UNAVAILABLE = "Projects are temporarily unavailable. Try again in a moment.";
const json = (body: unknown, ok = true) => ({
  ok,
  headers: { get: () => "application/json" },
  json: async () => body,
});

let search: () => Promise<unknown>;

function renderPage() {
  const client = new QueryClient();
  client.setQueryData(["discover-projects", 1], [{ projectId: 1, name: "Listed" }]);
  client.setQueryDefaults(["discover-projects", 1], { staleTime: Infinity });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

const type = (value: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Search revnets" }), {
    target: { value },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => search()),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("discover search", () => {
  it("shows the empty state only after the search answers with no results", async () => {
    let answer: (value: unknown) => void = () => {};
    search = () => new Promise((resolve) => (answer = resolve));
    renderPage();
    type("zzz");
    // Waiting out the debounce, then waiting on the response.
    expect(screen.queryByText(EMPTY)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.queryByText(EMPTY)).toBeNull();
    await act(async () => answer(json({ projects: [] })));
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it("does not report a failed search as no results", async () => {
    search = async () => json({}, false);
    renderPage();
    type("zzz");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it("does not report a rejected search as no results", async () => {
    search = async () => {
      throw new Error("offline");
    };
    renderPage();
    type("zzz");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it("does not report a too-short query as no results", () => {
    search = async () => json({ projects: [] });
    renderPage();
    type("z");
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText("Listed")).toBeInTheDocument();
  });

  it("restores the full grid when the query is cleared", async () => {
    search = async () => json({ projects: [] });
    renderPage();
    type("zzz");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    type("");
    expect(screen.getByText("Listed")).toBeInTheDocument();
  });

  it("shows results, with no shared byline on the cards", async () => {
    search = async () => json({ projects: [{ projectId: 2, name: "Banny", ticker: "BAN" }] });
    renderPage();
    expect(screen.queryByText("revnet.eth")).toBeNull();
    type("ban");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText("Banny")).toBeInTheDocument();
    expect(screen.queryByText("revnet.eth")).toBeNull();
  });
});
